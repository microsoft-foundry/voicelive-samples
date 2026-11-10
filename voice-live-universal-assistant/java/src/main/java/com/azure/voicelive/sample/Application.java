package com.azure.voicelive.sample;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.*;

import com.azure.core.credential.AzureKeyCredential;
import com.azure.identity.DefaultAzureCredentialBuilder;
import com.fasterxml.jackson.databind.ObjectMapper;

import jakarta.annotation.PreDestroy;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Spring Boot main class for the Voice Live Universal Assistant.
 * Provides REST endpoints, WebSocket support, and static file serving.
 */
@SpringBootApplication
@RestController
public class Application implements WebMvcConfigurer {

    private static final Logger logger = LoggerFactory.getLogger(Application.class);

    private static Object sharedCredential;
    private VoiceLiveWebSocketHandler wsHandler;

    // -- Credential (shared, created once) ---------------------------------

    private static synchronized Object getCredential() {
        if (sharedCredential == null) {
            String apiKey = envOrDefault("AZURE_VOICELIVE_API_KEY", null);
            if (apiKey != null) {
                sharedCredential = new AzureKeyCredential(apiKey);
                logger.info("Using API key credential");
            } else {
                sharedCredential = new DefaultAzureCredentialBuilder().build();
                logger.info("Using DefaultAzureCredential");
            }
        }
        return sharedCredential;
    }

    // -- Beans -------------------------------------------------------------

    @Bean
    public VoiceLiveWebSocketHandler voiceLiveWebSocketHandler() {
        String endpoint = envOrDefault("AZURE_VOICELIVE_ENDPOINT", null);
        Object credential = getCredential();
        wsHandler = new VoiceLiveWebSocketHandler(credential, endpoint);
        return wsHandler;
    }

    // -- CORS --------------------------------------------------------------

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOrigins("*")
                .allowedMethods("*")
                .allowedHeaders("*");
    }

    // -- Static file serving with SPA fallback -----------------------------

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // Serve from static/ directory (classpath or filesystem)
        registry.addResourceHandler("/assets/**")
                .addResourceLocations(
                        "classpath:/static/assets/",
                        "file:static/assets/",
                        "file:../frontend/dist/assets/")
                .setCachePeriod(31536000);  // 1 year — Vite hashes filenames
        registry.addResourceHandler("/**")
                .addResourceLocations(
                        "classpath:/static/",
                        "file:static/",
                        "file:../frontend/dist/")
                .resourceChain(true);
    }

    /**
     * SPA fallback — serve index.html for client-side routes.
     * Excludes: paths with file extensions, /api/*, /ws/*, /health, /config, /languages
     */
    @GetMapping(value = {
        "/{path:(?!api|ws|health|config|languages|assets)[^\\.]*}",
        "/{path:(?!api|ws|health|config|languages|assets)[^\\.]*}/{sub:[^\\.]*}",
        "/{path:(?!api|ws|health|config|languages|assets)[^\\.]*}/{sub:[^\\.]*}/{rest:[^\\.]*}"
    })
    public ResponseEntity<Resource> spaFallback() {
        return serveIndex();
    }

    private ResponseEntity<Resource> serveIndex() {
        // Try classpath first (Docker / packaged JAR)
        Resource index = new ClassPathResource("static/index.html");
        if (index.exists()) {
            return ResponseEntity.ok()
                    .contentType(MediaType.TEXT_HTML)
                    .body(index);
        }
        // Try filesystem locations (local dev)
        for (String loc : List.of("static/index.html", "../frontend/dist/index.html")) {
            Resource file = new org.springframework.core.io.FileSystemResource(loc);
            if (file.exists()) {
                return ResponseEntity.ok()
                        .contentType(MediaType.TEXT_HTML)
                        .body(file);
            }
        }
        return ResponseEntity.notFound().build();
    }

    // -- REST endpoints (identical to Python) ------------------------------

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "healthy", "service", "voicelive-websocket");
    }

    @GetMapping("/config")
    public Map<String, Object> config() {
        String apiKey = envOrDefault("AZURE_VOICELIVE_API_KEY", null);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("mode", envOrDefault("VOICELIVE_MODE", "model"));
        result.put("model", envOrDefault("VOICELIVE_MODEL", "gpt-realtime"));
        result.put("voice", envOrDefault("VOICELIVE_VOICE", "en-US-Ava:DragonHDLatestNeural"));
        result.put("voiceType", envOrDefault("VOICELIVE_VOICE_TYPE", "azure-standard"));
        result.put("transcribeModel", envOrDefault("VOICELIVE_TRANSCRIBE_MODEL", "gpt-4o-transcribe"));
        result.put("instructions", envOrDefault("VOICELIVE_INSTRUCTIONS",
                "You are a helpful AI assistant. Respond naturally and conversationally. Keep your responses concise but engaging."));
        result.put("agentName", envOrDefault("AZURE_VOICELIVE_AGENT_NAME", ""));
        result.put("project", envOrDefault("AZURE_VOICELIVE_PROJECT", ""));
        result.put("authMethod", apiKey != null ? "api_key" : "default_credential");
        result.put("allowClientAgentOverride", VoiceLiveWebSocketHandler.allowClientAgentOverride());
        return result;
    }

    // -- STT locale discovery (cached) ------------------------------------

    private static volatile List<String> sttLocalesCache;

    @GetMapping("/languages")
    public Map<String, Object> languages() {
        List<String> locales = fetchSttLocales();
        return Map.of("azureSpeechLocales", locales);
    }

    private List<String> fetchSttLocales() {
        if (sttLocalesCache != null) return sttLocalesCache;

        String endpoint = envOrDefault("AZURE_VOICELIVE_ENDPOINT", "").replaceAll("/+$", "");
        if (endpoint.isBlank()) return List.of();

        String apiVersion = envOrDefault("SPEECH_API_VERSION", "2025-10-15");
        String url = endpoint + "/speechtotext/transcriptions/locales?api-version=" + apiVersion;

        try {
            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder().uri(URI.create(url)).GET();

            String apiKey = envOrDefault("AZURE_VOICELIVE_API_KEY", null);
            if (apiKey != null) {
                reqBuilder.header("Ocp-Apim-Subscription-Key", apiKey);
            } else {
                // Token auth — get token from DefaultAzureCredential
                Object cred = getCredential();
                if (cred instanceof com.azure.identity.DefaultAzureCredential dac) {
                    String token = dac.getTokenSync(
                            new com.azure.core.credential.TokenRequestContext()
                                    .addScopes("https://cognitiveservices.azure.com/.default"))
                            .getToken();
                    reqBuilder.header("Authorization", "Bearer " + token);
                }
            }

            HttpClient httpClient = HttpClient.newBuilder()
                    .connectTimeout(java.time.Duration.ofSeconds(15))
                    .build();
            HttpResponse<String> response = httpClient.send(reqBuilder.build(),
                    HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() == 200) {
                ObjectMapper mapper = new ObjectMapper();
                @SuppressWarnings("unchecked")
                Map<String, Object> data = mapper.readValue(response.body(), Map.class);
                Set<String> allLocales = new TreeSet<>();
                for (Object value : data.values()) {
                    if (value instanceof List<?> list) {
                        for (Object item : list) {
                            if (item instanceof String s) {
                                allLocales.add(s);
                            }
                        }
                    }
                }
                sttLocalesCache = new ArrayList<>(allLocales);
                logger.info("Fetched {} STT locales from API", sttLocalesCache.size());
                return sttLocalesCache;
            } else {
                logger.warn("Failed to fetch STT locales: HTTP {}", response.statusCode());
            }
        } catch (Exception e) {
            logger.warn("Failed to fetch STT locales: {}", e.getMessage());
        }
        return List.of();
    }

    // -- Shutdown ----------------------------------------------------------

    @PreDestroy
    public void onShutdown() {
        if (wsHandler != null) {
            wsHandler.shutdownAll();
        }
        logger.info("Server shut down.");
    }

    // -- Helpers -----------------------------------------------------------

    private static String envOrDefault(String key, String defaultValue) {
        String v = System.getenv(key);
        if (v != null && !v.isBlank()) return v;
        // Fallback to system property (set by .env loader)
        v = System.getProperty(key);
        return (v != null && !v.isBlank()) ? v : defaultValue;
    }

    // -- Main --------------------------------------------------------------

    public static void main(String[] args) {
        // Load .env file if present (mimics Python's load_dotenv)
        loadDotEnv();
        logger.info("Starting Voice Live WebSocket server …");
        SpringApplication.run(Application.class, args);
    }

    /**
     * Simple .env loader — reads key=value pairs and sets them as system properties
     * (only if not already set as environment variables).
     */
    private static void loadDotEnv() {
        java.io.File envFile = new java.io.File(".env");
        if (!envFile.exists()) return;
        try (var reader = new java.io.BufferedReader(new java.io.FileReader(envFile))) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.strip();
                if (line.isEmpty() || line.startsWith("#")) continue;
                int eq = line.indexOf('=');
                if (eq <= 0) continue;
                String key = line.substring(0, eq).strip();
                String value = line.substring(eq + 1).strip();
                if (System.getenv(key) == null) {
                    System.setProperty(key, value);
                }
            }
        } catch (IOException e) {
            // Ignore — .env is optional
        }
    }
}
