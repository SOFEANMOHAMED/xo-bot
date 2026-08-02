# PowerShell script to add role column to merchants table
# Run with: .\add-role-migration.ps1

$env:Path = "C:\Program Files\PostgreSQL\16\bin;$env:Path"

# Load environment variables
if (Test-Path "..\.env") {
    Get-Content "..\.env" | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

$DB_HOST = if ($env:DB_HOST) { $env:DB_HOST } else { "localhost" }
$DB_PORT = if ($env:DB_PORT) { $env:DB_PORT } else { "5432" }
$DB_NAME = if ($env:DB_NAME) { $env:DB_NAME } else { "xobot_db" }
$DB_USER = if ($env:DB_USER) { $env:DB_USER } else { "postgres" }
$DB_PASSWORD = if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { "postgres" }

Write-Host "🔧 Adding role column to merchants table..." -ForegroundColor Cyan
Write-Host ""

# Set PGPASSWORD environment variable
$env:PGPASSWORD = $DB_PASSWORD

# Check if role column exists
Write-Host "🔍 Checking if role column exists..." -ForegroundColor Cyan
$checkResult = & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='merchants' AND column_name='role';" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error connecting to database. Make sure PostgreSQL is running." -ForegroundColor Red
    Write-Host $checkResult -ForegroundColor Red
    exit 1
}

if ($checkResult -match "role") {
    Write-Host "✅ Role column already exists" -ForegroundColor Green
} else {
    Write-Host "📝 Adding role column..." -ForegroundColor Cyan
    
    # Run the SQL file
    $sqlFile = Join-Path $PSScriptRoot "add-role-column.sql"
    if (-not (Test-Path $sqlFile)) {
        Write-Host "❌ Error: add-role-column.sql not found in current directory" -ForegroundColor Red
        exit 1
    }
    
    $result = & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f $sqlFile 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Error adding role column:" -ForegroundColor Red
        Write-Host $result -ForegroundColor Red
        exit 1
    }
    
    Write-Host "✅ Role column added successfully!" -ForegroundColor Green
}

Write-Host ""
Write-Host "✅ Migration complete!" -ForegroundColor Green
Write-Host "💡 You can now create a super admin using create-super-admin.ps1" -ForegroundColor Cyan

