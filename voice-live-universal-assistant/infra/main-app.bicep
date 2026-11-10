param location string
param tags object
param resourceToken string
param containerAppsEnvironmentId string
param containerRegistryName string

@description('Container image (set by azd deploy, defaults to placeholder for initial provision)')
param webImageName string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

// Voice Live configuration
param voiceLiveEndpoint string
@secure()
param voiceLiveApiKey string
param voiceLiveMode string
param voiceLiveAgentName string
param voiceLiveProject string
param voiceLiveModel string
param voiceLiveVoice string
param voiceLiveVoiceType string
param voiceLiveTranscribeModel string

@description('Foundry project endpoint (set by createFoundry or user-provided)')
param voiceLiveProjectEndpoint string = ''

@description('Allow unauthenticated /ws connections (sets VOICELIVE_ALLOW_ANONYMOUS)')
param allowAnonymous bool = false

var abbrs = loadJsonContent('./abbreviations.json')

module webApp './core/host/container-app.bicep' = {
  name: 'web-container-app'
  params: {
    name: '${abbrs.appContainerApps}web-${resourceToken}'
    location: location
    tags: union(tags, { 'azd-service-name': 'web' })
    containerAppsEnvironmentId: containerAppsEnvironmentId
    containerRegistryName: containerRegistryName
    containerImage: webImageName
    targetPort: 8000
    secrets: empty(voiceLiveApiKey) ? [] : [
      {
        name: 'voicelive-api-key'
        value: voiceLiveApiKey
      }
    ]
    env: concat(
      [
        {
          name: 'AZURE_VOICELIVE_ENDPOINT'
          value: voiceLiveEndpoint
        }
        {
          name: 'VOICELIVE_MODE'
          value: voiceLiveMode
        }
        {
          name: 'VOICELIVE_ALLOW_ANONYMOUS'
          value: string(allowAnonymous)
        }
        {
          name: 'AZURE_VOICELIVE_AGENT_NAME'
          value: voiceLiveAgentName
        }
        {
          name: 'AZURE_VOICELIVE_PROJECT'
          value: voiceLiveProject
        }
        {
          name: 'VOICELIVE_MODEL'
          value: voiceLiveModel
        }
        {
          name: 'VOICELIVE_VOICE'
          value: voiceLiveVoice
        }
        {
          name: 'VOICELIVE_VOICE_TYPE'
          value: voiceLiveVoiceType
        }
        {
          name: 'VOICELIVE_TRANSCRIBE_MODEL'
          value: voiceLiveTranscribeModel
        }
      ],
      empty(voiceLiveProjectEndpoint) ? [] : [
        {
          name: 'AZURE_VOICELIVE_PROJECT_ENDPOINT'
          value: voiceLiveProjectEndpoint
        }
      ],
      empty(voiceLiveApiKey) ? [] : [
        {
          name: 'AZURE_VOICELIVE_API_KEY'
          secretRef: 'voicelive-api-key'
        }
      ]
    )
    enableIngress: true
    external: true
  }
}

// NOTE: RBAC (Cognitive Services User) is handled by postprovision.ps1 hook
// to avoid ARM deployment failures on re-provision when assignments already exist.

output webEndpoint string = 'https://${webApp.outputs.fqdn}'
output webIdentityPrincipalId string = webApp.outputs.identityPrincipalId
output webAppName string = webApp.outputs.name
