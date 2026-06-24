# =============================================================================
#  RASCUNHO PARA REVISÃO — script do lado do colaborador (Windows / PowerShell)
# -----------------------------------------------------------------------------
#  Envia o banco comercial Access para o app periodicamente.
#  Como o Access roda no Windows, este é o caminho mais provável.
#
#  Configurar (1x):
#    - $AppUrl  : URL do app (ex.: https://relatorios.suaempresa.com.br)
#    - $Token   : valor de COMMERCIAL_IMPORT_TOKEN definido no servidor
#    - $DbPath  : caminho do propostas_bd.accdb na máquina do colaborador
#
#  Agendar: Agendador de Tarefas do Windows -> Tarefa Básica ->
#           Programa: powershell.exe
#           Argumentos: -ExecutionPolicy Bypass -File "C:\caminho\enviar-propostas.ps1"
#           Disparo: diário / a cada X horas.
# =============================================================================

$ErrorActionPreference = 'Stop'

$AppUrl = 'https://relatorios.suaempresa.com.br'
$Token  = 'COLE_AQUI_O_COMMERCIAL_IMPORT_TOKEN'
$DbPath = 'C:\Comercial\propostas_bd.accdb'

$Endpoint = "$AppUrl/api/acompanhamento/comercial/import"
$FileName = [System.IO.Path]::GetFileName($DbPath)

if (-not (Test-Path $DbPath)) {
    Write-Error "Arquivo não encontrado: $DbPath"
    exit 1
}

Write-Host "Enviando $FileName para $Endpoint ..."

try {
    $bytes = [System.IO.File]::ReadAllBytes($DbPath)
    $headers = @{
        'Authorization' = "Bearer $Token"
        'X-File-Name'   = $FileName
    }
    $response = Invoke-RestMethod -Uri $Endpoint -Method Post `
        -ContentType 'application/octet-stream' `
        -Headers $headers `
        -Body $bytes

    Write-Host "OK. Resumo da importacao:"
    $response | ConvertTo-Json -Depth 6
}
catch {
    Write-Error "Falha no envio: $($_.Exception.Message)"
    if ($_.ErrorDetails) { Write-Error $_.ErrorDetails.Message }
    exit 1
}
