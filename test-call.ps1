$req = [System.Net.HttpWebRequest]::Create("http://localhost:3000/api/calls/initiate/test-001")
$req.Method = "POST"
$req.ContentType = "application/json"
try {
    $resp = $req.GetResponse()
    Write-Host $resp.StatusCode
} catch {
    Write-Host $_.Exception.Message
}