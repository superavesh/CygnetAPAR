# Server Deployment Guide — APAR Client Manager

## Concept

Everything is built and packaged on the **dev laptop**.
The Windows Server only needs IIS enabled — no Node.js, no Python, no package managers.

| What | How it is embedded |
|---|---|
| Node.js runtime | Portable `node.exe` copied into the Next.js standalone folder |
| Python runtime + packages | PyInstaller compiles each scheduler into a single `.exe` |
| Service manager | `nssm.exe` bundled in `tools\` — no installation needed |

```
DEV LAPTOP
──────────────────────────────────────────────────────
Step 1  pg_dump   ──────────────────────────────────────► Ubuntu PostgreSQL
Step 2  npm run build  ──┐
Step 3  bundle node.exe  │
Step 4  pyinstaller      ├──► BUILD PACKAGE  ──► copy ──► WINDOWS SERVER
Step 5  create .env      │                               (IIS + 3 services)
Step 6  bundle nssm.exe ─┘
```

---

## Part 1 — Prepare the Ubuntu PostgreSQL Cluster

### 1.1 Dump the Existing Database (on dev laptop)

```cmd
pg_dump -h localhost -U postgres -d CygnetAPARMaster -F c -f C:\APARChatBot\backup\CygnetAPARMaster.dump
```

> If `pg_dump` is not on PATH:
> `"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"` ...same flags

### 1.2 Create the Application User (on Ubuntu server)

```bash
sudo -i -u postgres psql << 'EOF'
CREATE USER aparchatbot WITH ENCRYPTED PASSWORD 'YourSecurePassword123!';
CREATE DATABASE "CygnetAPARMaster" OWNER aparchatbot;
GRANT ALL PRIVILEGES ON DATABASE "CygnetAPARMaster" TO aparchatbot;
ALTER USER aparchatbot CREATEDB;
EOF
```

### 1.3 Copy and Restore the Dump (on Ubuntu server)

From the dev laptop:

```cmd
scp C:\APARChatBot\backup\CygnetAPARMaster.dump user@<UBUNTU_IP>:/tmp/
```

On the Ubuntu server:

```bash
pg_restore -h localhost -U aparchatbot -d CygnetAPARMaster /tmp/CygnetAPARMaster.dump
```

### 1.4 Allow Remote Connections from the Windows Server

```bash
# postgresql.conf
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" \
    /etc/postgresql/16/main/postgresql.conf

# pg_hba.conf — add one line (replace <WINDOWS_IP> with actual IP)
echo "host  all  aparchatbot  <WINDOWS_IP>/32  scram-sha-256" | \
    sudo tee -a /etc/postgresql/16/main/pg_hba.conf

sudo systemctl restart postgresql
sudo ufw allow from <WINDOWS_IP> to any port 5432
```

---

## Part 2 — Build the Next.js Application (Dev Laptop)

### 2.1 Enable Standalone Output

Edit [Web/next.config.js](../Web/next.config.js):

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
}

module.exports = nextConfig
```

### 2.2 Create the Production Environment File

Create `Web\.next\standalone\.env.production`
(place it **inside the standalone folder** — this is where `server.js` reads it at runtime).

Replace `<UBUNTU_IP>` with the real IP of your Ubuntu PostgreSQL server.

```env
MASTER_DB_HOST=<UBUNTU_IP>
MASTER_DB_PORT=5432
MASTER_DB_NAME=CygnetAPARMaster
MASTER_DB_USER=aparchatbot
MASTER_DB_PASSWORD=YourSecurePassword123!
PG_ADMIN_USER=aparchatbot
PG_ADMIN_PASSWORD=YourSecurePassword123!
NEXT_PUBLIC_APP_NAME=APAR Client Manager
NODE_ENV=production
```

> Create this file **after** the build in step 2.3 (the build creates the standalone folder).

### 2.3 Install Dependencies and Build

```cmd
cd D:\Avesh\APARChatBot\Web

npm ci
npm run build
```

Expected last line: `✓ Compiled successfully`

Now create `.env.production` at `D:\Avesh\APARChatBot\Web\.next\standalone\.env.production`
using the contents from 2.2 above.

### 2.4 Copy Static Assets into the Standalone Bundle

```cmd
cd D:\Avesh\APARChatBot\Web

xcopy /E /I /Y public        .next\standalone\public
xcopy /E /I /Y .next\static  .next\standalone\.next\static
```

### 2.5 Bundle Portable Node.js into the Standalone Folder

1. Download the **Windows x64 zip** (not the installer) from https://nodejs.org/en/download
   File: `node-v20.x.x-win-x64.zip`

2. Extract the zip. Inside the extracted folder, copy only `node.exe` into the standalone folder:

```cmd
:: Adjust the path to wherever you extracted the zip
copy C:\Downloads\node-v20.19.0-win-x64\node.exe D:\Avesh\APARChatBot\Web\.next\standalone\node.exe
```

The standalone folder now contains its own Node.js binary — the server runs with **no system Node.js required**.

---

## Part 3 — Build Embedded Python Schedulers (Dev Laptop)

PyInstaller packages the Python interpreter, all packages, and the script into a
self-contained folder. No Python installation is needed on the server.

### 3.1 Install PyInstaller

```cmd
pip install pyinstaller
```

### 3.2 Build ExportFiles Scheduler

```cmd
cd D:\Avesh\APARChatBot\schedulers\ExportFiles

pyinstaller ^
  --onedir ^
  --name APARExportScheduler ^
  --collect-all psycopg2 ^
  --hidden-import croniter ^
  --hidden-import dotenv ^
  scheduler_service.py
```

Output: `dist\APARExportScheduler\APARExportScheduler.exe` + all supporting files in the same folder.

Create the environment file **next to the exe** at
`schedulers\ExportFiles\dist\APARExportScheduler\.env`:

```env
MASTER_DB_HOST=<UBUNTU_IP>
MASTER_DB_PORT=5432
MASTER_DB_NAME=CygnetAPARMaster
PG_ADMIN_USER=aparchatbot
PG_ADMIN_PASSWORD=YourSecurePassword123!
EXPORT_OUTPUT_DIR=C:\APARChatBot\NFSShared
```

### 3.3 Build InsertData Scheduler

```cmd
cd D:\Avesh\APARChatBot\schedulers\InsertData

pyinstaller ^
  --onedir ^
  --name APARInsertScheduler ^
  --collect-all psycopg2 ^
  --hidden-import dotenv ^
  scheduler_service.py
```

Output: `dist\APARInsertScheduler\APARInsertScheduler.exe`

Create `schedulers\InsertData\dist\APARInsertScheduler\.env`:

```env
MASTER_DB_HOST=<UBUNTU_IP>
MASTER_DB_PORT=5432
MASTER_DB_NAME=CygnetAPARMaster
PG_ADMIN_USER=aparchatbot
PG_ADMIN_PASSWORD=YourSecurePassword123!
NFS_SHARED_DIR=C:\APARChatBot\NFSShared
CHECK_INTERVAL=60
BATCH_SIZE=100
ARCHIVE_PROCESSED=true
ARCHIVE_FOLDER=_processed
```

### 3.4 Test the Executables on the Dev Laptop

Before copying to the server, verify both executables run correctly:

```cmd
cd D:\Avesh\APARChatBot\schedulers\ExportFiles\dist\APARExportScheduler
APARExportScheduler.exe
:: Should print startup/log lines. Ctrl+C to stop.

cd D:\Avesh\APARChatBot\schedulers\InsertData\dist\APARInsertScheduler
APARInsertScheduler.exe
:: Should print startup/log lines. Ctrl+C to stop.
```

---

## Part 4 — Bundle NSSM (Dev Laptop)

NSSM is a single `.exe` that wraps any program as a Windows Service. No installation needed.

1. Download from https://nssm.cc/download — get the zip, not an installer
2. Extract and copy `win64\nssm.exe` to:

```cmd
mkdir D:\Avesh\APARChatBot\tools
copy <extracted>\win64\nssm.exe D:\Avesh\APARChatBot\tools\nssm.exe
```

---

## Part 5 — Final Package Structure

After all build steps, the folders to copy to the server are:

```
D:\Avesh\APARChatBot\
│
├── Web\
│   └── .next\
│       └── standalone\                ← copy entire folder
│           ├── server.js
│           ├── node.exe               ← portable Node.js (step 2.5)
│           ├── .env.production        ← production env (step 2.2)
│           ├── node_modules\          ← auto-generated by next build
│           ├── public\                ← copied in step 2.4
│           └── .next\
│               └── static\            ← copied in step 2.4
│
├── schedulers\
│   ├── ExportFiles\
│   │   └── dist\
│   │       └── APARExportScheduler\  ← copy entire folder
│   │           ├── APARExportScheduler.exe
│   │           ├── .env              ← step 3.2
│   │           └── ... (embedded Python + all deps)
│   └── InsertData\
│       └── dist\
│           └── APARInsertScheduler\  ← copy entire folder
│               ├── APARInsertScheduler.exe
│               ├── .env              ← step 3.3
│               └── ... (embedded Python + all deps)
│
└── tools\
    └── nssm.exe                      ← step 4
```

---

## Part 6 — Copy Package to Windows Server

Using RoboCopy from the dev laptop (both machines on the same network):

```cmd
:: Next.js standalone build
robocopy "D:\Avesh\APARChatBot\Web\.next\standalone" ^
         "\\<SERVER>\C$\APARChatBot\Web\.next\standalone" /E /MT:8

:: ExportFiles scheduler (PyInstaller output)
robocopy "D:\Avesh\APARChatBot\schedulers\ExportFiles\dist\APARExportScheduler" ^
         "\\<SERVER>\C$\APARChatBot\schedulers\ExportFiles" /E /MT:8

:: InsertData scheduler (PyInstaller output)
robocopy "D:\Avesh\APARChatBot\schedulers\InsertData\dist\APARInsertScheduler" ^
         "\\<SERVER>\C$\APARChatBot\schedulers\InsertData" /E /MT:8

:: NSSM tool
robocopy "D:\Avesh\APARChatBot\tools" ^
         "\\<SERVER>\C$\APARChatBot\tools" /E /MT:8
```

On the **Windows Server**, create the shared folder and logs directory:

```cmd
mkdir C:\APARChatBot\NFSShared
mkdir C:\APARChatBot\NFSShared\_processed
mkdir C:\APARChatBot\logs
```

---

## Part 7 — Enable IIS on the Windows Server

IIS is a built-in Windows feature — no download needed.

### 7.1 Enable IIS via Server Manager

1. Open **Server Manager → Add Roles and Features**
2. Select **Web Server (IIS)**
3. Under **Role Services** ensure these are checked:
   - Web Server → Common HTTP Features → Static Content, Default Document
   - Web Server → Application Development → (all optional here)
   - Management Tools → IIS Management Console

### 7.2 Install URL Rewrite and ARR Modules

Download and install both (small installers, ~5 MB each):

- **URL Rewrite 2.1** — https://www.iis.net/downloads/microsoft/url-rewrite
- **Application Request Routing 3.0** — https://www.iis.net/downloads/microsoft/application-request-routing

After installing ARR, enable the proxy:

1. Open **IIS Manager** → click the **server node** (top level)
2. Double-click **Application Request Routing Cache**
3. Right panel → **Server Proxy Settings**
4. Check **Enable proxy** → click **Apply**

---

## Part 8 — Register Windows Services with NSSM

Open **Command Prompt as Administrator** on the Windows Server.

### Next.js Web App Service

```cmd
C:\APARChatBot\tools\nssm.exe install APARWeb ^
    "C:\APARChatBot\Web\.next\standalone\node.exe"

C:\APARChatBot\tools\nssm.exe set APARWeb AppParameters ^
    "C:\APARChatBot\Web\.next\standalone\server.js"

C:\APARChatBot\tools\nssm.exe set APARWeb AppDirectory ^
    "C:\APARChatBot\Web\.next\standalone"

C:\APARChatBot\tools\nssm.exe set APARWeb AppEnvironmentExtra ^
    "NODE_ENV=production" "PORT=3000" "HOSTNAME=127.0.0.1"

C:\APARChatBot\tools\nssm.exe set APARWeb AppStdout ^
    "C:\APARChatBot\logs\web.log"

C:\APARChatBot\tools\nssm.exe set APARWeb AppStderr ^
    "C:\APARChatBot\logs\web-error.log"

C:\APARChatBot\tools\nssm.exe set APARWeb Start SERVICE_AUTO_START
```

### ExportFiles Scheduler Service

```cmd
C:\APARChatBot\tools\nssm.exe install APARExportScheduler ^
    "C:\APARChatBot\schedulers\ExportFiles\APARExportScheduler.exe"

C:\APARChatBot\tools\nssm.exe set APARExportScheduler AppDirectory ^
    "C:\APARChatBot\schedulers\ExportFiles"

C:\APARChatBot\tools\nssm.exe set APARExportScheduler AppStdout ^
    "C:\APARChatBot\logs\export-scheduler.log"

C:\APARChatBot\tools\nssm.exe set APARExportScheduler AppStderr ^
    "C:\APARChatBot\logs\export-scheduler-error.log"

C:\APARChatBot\tools\nssm.exe set APARExportScheduler Start SERVICE_AUTO_START
```

### InsertData Scheduler Service

```cmd
C:\APARChatBot\tools\nssm.exe install APARInsertScheduler ^
    "C:\APARChatBot\schedulers\InsertData\APARInsertScheduler.exe"

C:\APARChatBot\tools\nssm.exe set APARInsertScheduler AppDirectory ^
    "C:\APARChatBot\schedulers\InsertData"

C:\APARChatBot\tools\nssm.exe set APARInsertScheduler AppStdout ^
    "C:\APARChatBot\logs\insert-scheduler.log"

C:\APARChatBot\tools\nssm.exe set APARInsertScheduler AppStderr ^
    "C:\APARChatBot\logs\insert-scheduler-error.log"

C:\APARChatBot\tools\nssm.exe set APARInsertScheduler Start SERVICE_AUTO_START
```

### Start All Three Services

```cmd
net start APARWeb
net start APARExportScheduler
net start APARInsertScheduler
```

Verify all are running:

```cmd
sc query APARWeb
sc query APARExportScheduler
sc query APARInsertScheduler
```

All three must show `STATE: 4  RUNNING`.

---

## Part 9 — Configure IIS Site

### 9.1 Create the Site

1. **IIS Manager** → right-click **Sites** → **Add Website**
2. Fill in:
   - Site name: `APARChatBot`
   - Physical path: `C:\APARChatBot\Web\.next\standalone\public`
   - Binding: HTTP, port 80, host name = your domain or server IP

### 9.2 Add the Reverse Proxy Rule

Create `C:\APARChatBot\Web\.next\standalone\public\web.config`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>

    <rewrite>
      <rules>

        <!-- Optional: redirect HTTP to HTTPS (uncomment if you have a certificate) -->
        <!--
        <rule name="HTTP to HTTPS" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTPS}" pattern="off" />
          </conditions>
          <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Permanent" />
        </rule>
        -->

        <!-- Forward all requests to Next.js -->
        <rule name="ReverseProxyToNextJS" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:3000/{R:1}" />
        </rule>

      </rules>
    </rewrite>

  </system.webServer>
</configuration>
```

### 9.3 (Optional) HTTPS

1. In IIS Manager → site **Bindings** → **Add** → HTTPS, port 443, select your certificate
2. Uncomment the HTTP → HTTPS redirect rule in `web.config` above

---

## Part 10 — Windows Firewall

Open **PowerShell as Administrator** on the Windows Server:

```powershell
# Allow public web traffic
New-NetFirewallRule -DisplayName "APAR HTTP"  -Direction Inbound -Protocol TCP -LocalPort 80  -Action Allow
New-NetFirewallRule -DisplayName "APAR HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow

# Block direct access to Node.js from outside — IIS only
New-NetFirewallRule -DisplayName "Block Node Direct" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Block
```

---

## Part 11 — Validation

```cmd
:: Services running?
sc query APARWeb
sc query APARExportScheduler
sc query APARInsertScheduler

:: Node.js responding directly?
curl http://127.0.0.1:3000

:: Responding through IIS on port 80?
curl http://localhost

:: NFSShared directory writable?
dir C:\APARChatBot\NFSShared

:: Any startup errors?
type C:\APARChatBot\logs\web-error.log
type C:\APARChatBot\logs\export-scheduler-error.log
type C:\APARChatBot\logs\insert-scheduler-error.log
```

---

## Part 12 — Deploying Updates

All rebuild work happens on the **dev laptop**.

### Update Next.js

```cmd
:: On dev laptop
cd D:\Avesh\APARChatBot\Web
npm ci
npm run build
xcopy /E /I /Y public        .next\standalone\public
xcopy /E /I /Y .next\static  .next\standalone\.next\static
:: node.exe is already in standalone from the first build — no need to copy again

:: Stop service on server, copy new build, restart
net stop APARWeb   :: (run on server or via remote cmd)
robocopy "D:\Avesh\APARChatBot\Web\.next\standalone" "\\<SERVER>\C$\APARChatBot\Web\.next\standalone" /E /MT:8 /PURGE
net start APARWeb  :: (run on server or via remote cmd)
```

### Update a Python Scheduler

```cmd
:: On dev laptop — rebuild PyInstaller exe
cd D:\Avesh\APARChatBot\schedulers\ExportFiles
pyinstaller --onedir --name APARExportScheduler --collect-all psycopg2 --hidden-import croniter --hidden-import dotenv scheduler_service.py

:: Restore .env into the new dist folder
copy .env dist\APARExportScheduler\.env

:: Stop service on server, copy new build, restart
net stop APARExportScheduler
robocopy "D:\Avesh\APARChatBot\schedulers\ExportFiles\dist\APARExportScheduler" "\\<SERVER>\C$\APARChatBot\schedulers\ExportFiles" /E /MT:8 /PURGE
net start APARExportScheduler
```

---

## Summary Checklist

### On Ubuntu PostgreSQL
- [ ] Created `aparchatbot` user with `CREATEDB` privilege
- [ ] Restored `CygnetAPARMaster.dump`
- [ ] Added Windows Server IP to `pg_hba.conf`
- [ ] Restarted PostgreSQL + opened ufw port 5432

### On Dev Laptop
- [ ] `output: 'standalone'` added to `next.config.js`
- [ ] `npm run build` succeeded
- [ ] Static assets copied into standalone (`xcopy public` + `xcopy .next\static`)
- [ ] `node.exe` (portable) placed in `.next\standalone\`
- [ ] `.env.production` created inside `.next\standalone\`
- [ ] PyInstaller built `APARExportScheduler.exe` + `.env` placed next to it
- [ ] PyInstaller built `APARInsertScheduler.exe` + `.env` placed next to it
- [ ] Both `.exe` files tested and ran successfully on dev laptop
- [ ] `nssm.exe` placed in `tools\`
- [ ] All folders RoboCopied to Windows Server

### On Windows Server
- [ ] IIS enabled (Server Manager)
- [ ] URL Rewrite 2.1 installed
- [ ] ARR 3.0 installed + proxy enabled
- [ ] `NFSShared\`, `NFSShared\_processed\`, `logs\` directories created
- [ ] All 3 NSSM services registered and showing `RUNNING`
- [ ] IIS site created pointing to `standalone\public`
- [ ] `web.config` placed in `standalone\public\`
- [ ] Firewall: 80/443 open, 3000 blocked externally
- [ ] `curl http://localhost` returns app HTML
