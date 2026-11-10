<#
.SYNOPSIS
    Post-provision hook — assigns RBAC roles to the Container App managed identity.
    When Foundry is provisioned, also assigns Azure AI Developer role for Foundry access.
    Using a hook (not Bicep) for RBAC avoids re-provision failures when assignments already exist.
    Also enables Container Apps authentication (Microsoft Entra ID) so only signed-in users
    can reach the app, unless VOICELIVE_ALLOW_ANONYMOUS=true.
#>
param()

$ErrorActionPreference = "Stop"

Write-Host "===== Post-Provision: RBAC Assignment ====="

$principalId = azd env get-value WEB_IDENTITY_PRINCIPAL_ID 2>$null
$subscriptionId = azd env get-value AZURE_SUBSCRIPTION_ID 2>$null
$createFoundry = azd env get-value CREATE_FOUNDRY 2>$null
$createAgent = azd env get-value CREATE_AGENT 2>$null
$foundryAccountName = azd env get-value FOUNDRY_ACCOUNT_NAME 2>$null
$rgName = azd env get-value AZURE_RESOURCE_GROUP_NAME 2>$null

# createAgent implies createFoundry
$effectiveCreateFoundry = ($createFoundry -eq "true") -or ($createAgent -eq "true")

if (-not $principalId) {
    Write-Host "Container App identity not available yet -- skipping RBAC."
    exit 0
}

# Cognitive Services User -- allows DefaultAzureCredential to authenticate to Voice Live API
$cogServicesUserRole = "a97b65f3-24c7-4388-baec-2e87135dc908"

Write-Host "Assigning Cognitive Services User role to managed identity..."
Write-Host "  Principal: $principalId"

az role assignment create `
    --assignee-object-id $principalId `
    --assignee-principal-type ServicePrincipal `
    --role $cogServicesUserRole `
    --scope "/subscriptions/$subscriptionId" `
    --output none 2>$null

if ($LASTEXITCODE -eq 0) {
    Write-Host "  [OK] Cognitive Services User role assigned"
} else {
    Write-Host "  [SKIP] Role assignment may already exist (safe to ignore)"
}

# When Foundry was provisioned, also assign Azure AI Developer for agent/model access
if ($effectiveCreateFoundry -and $foundryAccountName) {
    Write-Host ""
    Write-Host "===== Foundry RBAC: Azure AI Developer ====="

    $aiDeveloperRole = "64702f94-c441-49e6-a78b-ef80e0188fee"
    $accountScope = "/subscriptions/$subscriptionId/resourceGroups/$rgName/providers/Microsoft.CognitiveServices/accounts/$foundryAccountName"

    Write-Host "  Scope: $accountScope"

    az role assignment create `
        --assignee-object-id $principalId `
        --assignee-principal-type ServicePrincipal `
        --role $aiDeveloperRole `
        --scope $accountScope `
        --output none 2>$null

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [OK] Azure AI Developer role assigned on Foundry account"
    } else {
        Write-Host "  [SKIP] Role assignment may already exist (safe to ignore)"
    }
}

# -----------------------------------------------------------------------------
# Container Apps authentication (Microsoft Entra ID)
# -----------------------------------------------------------------------------
# The app's /ws endpoint rejects connections that do not come through Container Apps
# authentication. Configure it here (an app registration needs Microsoft Graph, which
# Bicep cannot create) so the deployed app requires sign-in by default.
Write-Host ""
Write-Host "===== Container Apps Authentication ====="

$allowAnonymous = azd env get-value VOICELIVE_ALLOW_ANONYMOUS 2>$null
$containerAppName = azd env get-value AZURE_CONTAINER_APP_NAME 2>$null
$webEndpoint = azd env get-value WEB_ENDPOINT 2>$null
$envName = azd env get-value AZURE_ENV_NAME 2>$null

function Assert-AzSucceeded([string]$step) {
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to $step. The app still rejects unauthenticated /ws connections; fix the error (for example, permission to create app registrations) and run 'azd provision' again."
    }
}

if ($allowAnonymous -eq "true") {
    Write-Host "  [WARN] VOICELIVE_ALLOW_ANONYMOUS=true -- skipping authentication. Anyone who can reach the app can start sessions using its identity."
} elseif (-not $containerAppName -or -not $webEndpoint) {
    Write-Host "  [SKIP] Container App not available yet"
} else {
    $existingClientId = az containerapp auth microsoft show `
        --name $containerAppName --resource-group $rgName `
        --query "registration.clientId" --output tsv 2>$null

    if ($existingClientId) {
        Write-Host "  [SKIP] Authentication already configured (client ID: $existingClientId)"
    } else {
        $tenantId = az account show --query tenantId --output tsv
        Assert-AzSucceeded "read the tenant ID"
        $displayName = "voicelive-$envName-auth"
        $redirectUri = "$webEndpoint/.auth/login/aad/callback"

        $clientId = az ad app list --display-name $displayName --query "[0].appId" --output tsv
        Assert-AzSucceeded "look up the app registration"
        if (-not $clientId) {
            Write-Host "  Creating app registration '$displayName'..."
            $clientId = az ad app create `
                --display-name $displayName `
                --sign-in-audience AzureADMyOrg `
                --enable-id-token-issuance true `
                --web-redirect-uris $redirectUri `
                --query appId --output tsv
            Assert-AzSucceeded "create the app registration"
        } else {
            Write-Host "  Reusing app registration '$displayName' ($clientId)"
            az ad app update --id $clientId --enable-id-token-issuance true --web-redirect-uris $redirectUri --output none
            Assert-AzSucceeded "update the app registration"
        }

        az ad sp show --id $clientId --output none 2>$null
        if ($LASTEXITCODE -ne 0) {
            az ad sp create --id $clientId --output none
            Assert-AzSucceeded "create the service principal"
        }

        # Client secret is passed straight to the Container App (stored as an app secret), never printed.
        $clientSecret = az ad app credential reset `
            --id $clientId --display-name "container-apps-auth" --append --years 1 `
            --query password --output tsv 2>$null
        Assert-AzSucceeded "create the client secret"

        az containerapp auth microsoft update `
            --name $containerAppName --resource-group $rgName `
            --client-id $clientId --client-secret $clientSecret --tenant-id $tenantId `
            --yes --output none
        Assert-AzSucceeded "configure the Microsoft Entra ID provider"

        az containerapp auth update `
            --name $containerAppName --resource-group $rgName `
            --enabled true `
            --unauthenticated-client-action RedirectToLoginPage `
            --redirect-provider azureactivedirectory `
            --require-https true `
            --output none
        Assert-AzSucceeded "require authentication"

        azd env set AUTH_CLIENT_ID $clientId
        Write-Host "  [OK] Sign-in required (Microsoft Entra ID, app registration $clientId)"
        Write-Host "       The client secret expires in 1 year; rotate it with 'az ad app credential reset'."
    }
}

Write-Host "===== Post-Provision Complete ====="
