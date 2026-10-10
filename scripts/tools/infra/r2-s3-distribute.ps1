# SPDX-License-Identifier: Apache-2.0
# Relevant existing provider consumer stores only; secrets travel via SSH stdin.
[CmdletBinding()]
param([ValidateSet('vps','dbfr')][string[]]$Hosts=@('vps','dbfr'),[string]$StateRoot)
$ErrorActionPreference='Stop'
if(-not $StateRoot){$StateRoot=if($env:APHRODY_HOME){$env:APHRODY_HOME}else{Join-Path $env:USERPROFILE '.aphrody'}}
Add-Type -AssemblyName System.Security
$bytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $StateRoot 'auth/cloudflare/r2-s3.dpapi')),$null,'CurrentUser')
try{
    $credential=[Text.Encoding]::UTF8.GetString($bytes)|ConvertFrom-Json
    $updates=@{AWS_ACCESS_KEY_ID=$credential.accessKeyId;AWS_SECRET_ACCESS_KEY=$credential.secretAccessKey;R2_ENDPOINT=$credential.endpoint}
    $path=Join-Path $StateRoot 'config/cloudflare.env'
    if(-not (Test-Path -LiteralPath $path)){throw 'Existing local provider consumer store required'}
    $original=[IO.File]::ReadAllBytes($path)
    $backup=$path+'.backup-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    [IO.File]::WriteAllBytes($backup,$original)
    if((Get-FileHash $backup -Algorithm SHA256).Hash -ne (Get-FileHash $path -Algorithm SHA256).Hash){throw 'Local consumer backup mismatch'}
    Set-Acl -LiteralPath $backup -AclObject (Get-Acl -LiteralPath $path)
    $lines=@([IO.File]::ReadAllLines($path)|Where-Object {$_ -notmatch '^(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|R2_ENDPOINT)='})
    foreach($name in $updates.Keys){$lines+=($name+'='+$updates[$name])}
    [IO.File]::WriteAllLines($path,$lines)
    Write-Output 'Updated existing protected local Cloudflare S3 consumer; API credential preserved.'
    $remote=@'
import sys,json,pathlib,os,hashlib,time,subprocess
payload=json.load(sys.stdin)
updates=payload['updates']
p=pathlib.Path.home()/'.aphrody/config/cloudflare.env'
if not p.is_file(): raise SystemExit('Existing remote provider consumer required')
original=p.read_bytes()
backup=p.with_name(p.name+'.backup-'+str(time.time_ns()))
fd=os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'wb') as f: f.write(original)
if hashlib.sha256(backup.read_bytes()).digest()!=hashlib.sha256(original).digest(): raise SystemExit('Backup checksum mismatch')
lines=[s for s in original.decode().splitlines() if s.split('=',1)[0] not in updates]
lines.extend(k+'='+v for k,v in updates.items())
temporary=p.with_name(p.name+'.s3-new-'+str(time.time_ns()))
fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f: f.write('\n'.join(lines)+'\n')
os.replace(temporary,p)
os.chmod(p.parent,0o700)
environment=os.environ.copy()
for line in lines:
 if '=' in line:
  key,value=line.split('=',1)
  environment[key]=value.strip().strip('\"').strip("'")
qualified=subprocess.run(['bun','-e',payload['probe']],env=environment,capture_output=True,text=True,timeout=40)
if qualified.returncode: raise SystemExit('Remote S3 qualification failed; raw provider output withheld')
proof=[json.loads(line) for line in qualified.stdout.splitlines() if line.startswith('{')]
if len(proof)!=2 or not all(x.get('deletedProbe') for x in proof): raise SystemExit('Remote S3 proof incomplete')
print('Protected S3 consumer updated; existing API credential preserved; mode='+oct(p.stat().st_mode&0o777)+'; both buckets qualified')
'@
    $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remote))
    foreach($hostName in $Hosts){
        # Native Infra exec exposes no stdin transport; qualified installed SSH fills that gap.
        $start=New-Object Diagnostics.ProcessStartInfo
        $start.FileName=(Get-Command ssh).Source
        $python='import base64;exec(base64.b64decode("'+$encoded+'"))'
        $command="python3 -c '"+$python+"'"
        $start.Arguments=$hostName+' "'+$command.Replace('"','\"')+'"'
        $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
        $process=New-Object Diagnostics.Process;$process.StartInfo=$start
        try{
            $probe=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../../audit/r2-s3-protected.ts'))
            $process.Start()|Out-Null;$process.StandardInput.Write((@{updates=$updates;probe=$probe}|ConvertTo-Json -Compress));$process.StandardInput.Close()
            $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
            if(-not $process.WaitForExit(45000)){$process.Kill();throw 'Protected consumer transfer timeout'}
            if($process.ExitCode){throw ('Protected consumer update failed on '+$hostName)}
            Write-Output ($hostName+': '+$stdout.GetAwaiter().GetResult().Trim())
        }finally{$process.Dispose()}
    }
}finally{[Array]::Clear($bytes,0,$bytes.Length);$credential=$null;$updates=$null}
