# PowerShell script to create super admin user
# Run with: .\create-super-admin.ps1

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

$SUPER_ADMIN_EMAIL = if ($env:SUPER_ADMIN_EMAIL) { $env:SUPER_ADMIN_EMAIL } else { "admin@xobot.ai" }
$SUPER_ADMIN_PASSWORD = if ($env:SUPER_ADMIN_PASSWORD) { $env:SUPER_ADMIN_PASSWORD } else { "admin123456" }
$SUPER_ADMIN_NAME = if ($env:SUPER_ADMIN_NAME) { $env:SUPER_ADMIN_NAME } else { "Super Admin" }

Write-Host "🔧 Creating Super Admin..." -ForegroundColor Cyan
Write-Host "📧 Email: $SUPER_ADMIN_EMAIL" -ForegroundColor Yellow
Write-Host "🔑 Password: $SUPER_ADMIN_PASSWORD" -ForegroundColor Yellow
Write-Host ""

# Set PGPASSWORD environment variable
$env:PGPASSWORD = $DB_PASSWORD

# First, ensure role column exists
Write-Host "📋 Checking role column..." -ForegroundColor Cyan
$checkRoleColumn = & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='merchants' AND column_name='role';" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error checking role column. Make sure PostgreSQL is running and credentials are correct." -ForegroundColor Red
    exit 1
}

if ($checkRoleColumn -match "role") {
    Write-Host "✅ Role column exists" -ForegroundColor Green
} else {
    Write-Host "📝 Adding role column..." -ForegroundColor Cyan
    $addRoleResult = & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "add-role-column.sql" 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Error adding role column:" -ForegroundColor Red
        Write-Host $addRoleResult -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Role column added" -ForegroundColor Green
}

# Hash password using Node.js
Write-Host "🔐 Hashing password..." -ForegroundColor Cyan
$hashScript = @"
const bcrypt = require('bcryptjs');
const password = '$SUPER_ADMIN_PASSWORD';
bcrypt.hash(password, 10).then(hash => {
    console.log(hash);
});
"@

$hashScript | Out-File -FilePath "temp-hash.js" -Encoding UTF8
$passwordHash = node temp-hash.js
Remove-Item "temp-hash.js"

if (-not $passwordHash -or $passwordHash -match "Error") {
    Write-Host "❌ Error hashing password. Make sure Node.js and bcryptjs are installed." -ForegroundColor Red
    Write-Host "💡 Install bcryptjs: npm install bcryptjs" -ForegroundColor Yellow
    exit 1
}

$passwordHash = $passwordHash.Trim()

# Check if admin exists
Write-Host "🔍 Checking if admin exists..." -ForegroundColor Cyan
$existingAdmin = & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT id FROM merchants WHERE email = '$SUPER_ADMIN_EMAIL';" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error checking existing admin:" -ForegroundColor Red
    Write-Host $existingAdmin -ForegroundColor Red
    exit 1
}

if ($existingAdmin -match "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}") {
    # Update existing admin
    Write-Host "🔄 Updating existing admin..." -ForegroundColor Cyan
    $updateQuery = "UPDATE merchants SET role = 'owner', password_hash = '$passwordHash', name = '$SUPER_ADMIN_NAME', updated_at = CURRENT_TIMESTAMP WHERE email = '$SUPER_ADMIN_EMAIL';"
    $updateResult = & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c $updateQuery 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Error updating admin:" -ForegroundColor Red
        Write-Host $updateResult -ForegroundColor Red
        exit 1
    }
    
    Write-Host "✅ Super admin updated successfully!" -ForegroundColor Green
} else {
    # Create new admin
    Write-Host "➕ Creating new admin..." -ForegroundColor Cyan
    $insertQuery = @"
INSERT INTO merchants (email, password_hash, name, role, subscription_plan, subscription_status)
VALUES ('$SUPER_ADMIN_EMAIL', '$passwordHash', '$SUPER_ADMIN_NAME', 'owner', 'business', 'active')
RETURNING id;
"@
    
    $insertResult = & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c $insertQuery 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Error creating admin:" -ForegroundColor Red
        Write-Host $insertResult -ForegroundColor Red
        exit 1
    }
    
    $merchantId = ($insertResult -match "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}") | Out-String
    $merchantId = $merchantId.Trim()
    
    # Create default settings
    Write-Host "⚙️ Creating default settings..." -ForegroundColor Cyan
    $settingsQuery = @"
INSERT INTO merchant_settings (merchant_id, store_name, welcome_message, store_currency)
VALUES ('$merchantId', 'Admin Store', 'Welcome to Admin Store', 'USD');
"@
    
    $settingsResult = & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c $settingsQuery 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "⚠️ Warning: Could not create default settings (may already exist)" -ForegroundColor Yellow
    }
    
    Write-Host "✅ Super admin created successfully!" -ForegroundColor Green
    Write-Host "🆔 Merchant ID: $merchantId" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "✅ Setup Complete!" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "📧 Email: $SUPER_ADMIN_EMAIL" -ForegroundColor White
Write-Host "🔑 Password: $SUPER_ADMIN_PASSWORD" -ForegroundColor White
Write-Host "👤 Role: owner" -ForegroundColor White
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "💡 You can now login with these credentials!" -ForegroundColor Green

