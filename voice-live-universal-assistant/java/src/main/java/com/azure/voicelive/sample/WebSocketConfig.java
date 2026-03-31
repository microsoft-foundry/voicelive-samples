package com.azure.voicelive.sample;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

/**
 * Spring WebSocket configuration — registers the VoiceLive handler at /ws/{clientId}.
 */
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final VoiceLiveWebSocketHandler handler;

    public WebSocketConfig(VoiceLiveWebSocketHandler handler) {
        this.handler = handler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/ws/**")
                .setAllowedOrigins("*");
    }

    @Bean
    public ServletServerContainerFactoryBean createWebSocketContainer() {
        var container = new ServletServerContainerFactoryBean();
        // Voice Live sessions stream audio continuously — disable idle timeout
        container.setMaxSessionIdleTimeout(0L);
        // Allow large messages — audio chunks are base64-encoded and can exceed default limits
        container.setMaxBinaryMessageBufferSize(512 * 1024);
        container.setMaxTextMessageBufferSize(512 * 1024);
        return container;
    }
}
