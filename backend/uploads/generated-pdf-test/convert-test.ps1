param([string]$DocxPath,[string]$PdfPath)
$ErrorActionPreference = 'Stop'
$word = $null
$document = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $document = $word.Documents.Open($DocxPath, $false, $true)
  $document.ExportAsFixedFormat($PdfPath, 17)
} finally {
  if($document -ne $null){ $document.Close([ref]$false) }
  if($word -ne $null){ $word.Quit() }
}
