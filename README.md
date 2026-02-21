# IMPORTANT
Only sparse-checkout the **avatar replacer** folder (with `index.tsx`) like the install instructions below.
If you clone the repo wrong / dump extra folders into userplugins, you can cause errors.

## DISCLAIMER
**THIS PLUGIN MIGHT GET YOU BANNED FROM DISCORD SO USE IT AT YOUR OWN RISK. I'M NOT RESPONSIBLE FOR ANY BANS.**

---

# vencord-avatar-replacer

Clientside avatar overrides per-user (only you see it).

## Features
- Right click a user → **Change profile picture**
- Also works from the **full profile** menus
- Uses native **file picker**
- Saves permanently **until the user changes their real avatar**, then it resets automatically (or you remove it manually)

## Screenshots
<img width="296" height="799" alt="image" src="https://github.com/user-attachments/assets/a0481821-3fdc-4037-a396-09e6fdddaf52" />
<img width="785" height="707" alt="image" src="https://github.com/user-attachments/assets/b0c16915-a244-4b5d-836f-30d17bc1a089" />
<img width="1131" height="903" alt="image" src="https://github.com/user-attachments/assets/5c25464a-c8ed-45bb-ac88-6f367904d185" />
<img width="294" height="396" alt="image" src="https://github.com/user-attachments/assets/c924ff1d-2ce1-40af-b28e-d7a2db0ec2ce" />

# Installation

## First Time Setup
Vencord isn't modular, so you'll need to build from source to add custom plugins.
Check out this guide to get started:
https://docs.vencord.dev/installing/custom-plugins/

## Installation (PowerShell)
Open PowerShell in your Vencord repo folder and run:

```powershell
cd src/userplugins
Remove-Item -Recurse -Force "vencord-avatar-replacer" -ErrorAction SilentlyContinue; mkdir "vencord-avatar-replacer"; git clone --no-checkout https://github.com/loadstr0/vencord-avatar-replacer temp; cd temp; git sparse-checkout init --cone; git sparse-checkout set "avatar replacer"; git checkout; Move-Item "avatar replacer/*" "../vencord-avatar-replacer/" -Force; cd ..; Remove-Item -Recurse -Force temp
