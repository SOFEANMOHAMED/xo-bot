# Script to create support_tickets table
# Usage: .\create-support-tickets-table.ps1

$ErrorActionPreference = "Stop"

# Database connection parameters
$dbName = "xobot_db"
$dbUser = "postgres"
$dbPassword = Read-Host "Enter PostgreSQL password for user '$dbUser'" -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbPassword)
$dbPasswordPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)

# Find PostgreSQL installation
$pgPaths = @(
    "C:\Program Files\PostgreSQL\18\bin\psql.exe",
    "C:\Program Files\PostgreSQL\17\bin\psql.exe",
    "C:\Program Files\PostgreSQL\16\bin\psql.exe",
    "C:\Program Files\PostgreSQL\15\bin\psql.exe",
    "C:\Program Files\PostgreSQL\14\bin\psql.exe"
)

$psqlPath = $null
foreach ($path in $pgPaths) {
    if (Test-Path $path) {
        $psqlPath = $path
        break
    }
}

if (-not $psqlPath) {
    Write-Host "❌ PostgreSQL not found. Please install PostgreSQL or add psql to PATH." -ForegroundColor Red
    Write-Host "Alternatively, you can run the SQL manually in pgAdmin or any PostgreSQL client." -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Found PostgreSQL at: $psqlPath" -ForegroundColor Green

# SQL file path
$sqlFile = Join-Path $PSScriptRoot "create-support-tickets-table.sql"

if (-not (Test-Path $sqlFile)) {
    Write-Host "❌ SQL file not found: $sqlFile" -ForegroundColor Red
    exit 1
}

Write-Host "📝 Running SQL script..." -ForegroundColor Cyan

# Set PGPASSWORD environment variable
$env:PGPASSWORD = $dbPasswordPlain

try {
    # Run SQL script
    & $psqlPath -U $dbUser -d $dbName -f $sqlFile
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Support tickets table created successfully!" -ForegroundColor Green
    } else {
        Write-Host "❌ Error creating support tickets table. Exit code: $LASTEXITCODE" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    exit 1
} finally {
    # Clear password from environment
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

Write-Host "`n✨ Done! You can now use the support tickets feature." -ForegroundColor Green

