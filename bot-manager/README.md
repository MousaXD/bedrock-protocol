# Bedrock Bot Manager

A dependency-free local web dashboard for launching and monitoring authenticated `bedrock-protocol` clients.

## Run

```bash
npm install
npm run bot-manager
```

Then open:

```text
http://127.0.0.1:3210
```

The dashboard binds to loopback only. It is not exposed to your LAN.

## First login

The default config contains two account slots, `account1` and `account2`.

1. Click **Connect** on account 1.
2. Follow the Microsoft device-code prompt displayed on the account card.
3. Sign in with the first Microsoft/Xbox account.
4. Wait for the status to reach **spawned**.
5. Repeat with account 2.

Each account gets a separate auth cache:

```text
profiles/
  account1/
  account2/
```

These folders and `.bedrock-bot-manager.json` are ignored by Git. Do not share the profile folders.

## Server settings

The dashboard defaults to:

- Host: `tahasmp.net`
- Port: `19132`
- Target: `-65 -26 -14`

The port is editable because Bedrock/cross-play servers do not always use 19132.

## RakNet backend

The library now defaults to `raknetBackend: 'auto'`.

It tries `raknet-native` when the optional native module is usable and falls back to `jsp-raknet` when it is not. This means Node/Linux users no longer need CMake just to use the library.

## Scope of this first dashboard

This version intentionally handles authentication, connection lifecycle, server selection, live status, initial/current server-corrected position, logs, and target-coordinate storage.

Movement, hotbar selection, block breaking, and placement require server-authoritative 1.26 input/transaction state. They should be added only after a real account successfully joins and its live packets are captured/validated, rather than sending guessed legacy packets.
