# Setup: Firebase (prepared path)

The shipped backend uses **SQLite** (zero credentials, real transactions). The files in `firebase/` prepare a **Firebase-native deployment** — primarily for the future Flutter client that talks to Firestore directly with the same authorization model.

## What's included

- `firebase/firestore.rules` — ownership isolation mirroring the API: users read/write only their own workspace, projects, backlog items, drafts and executions; all writes validate shape and status transitions where expressible.
- `firebase/firestore.indexes.json` — composite indexes for backlog/sprint queries.
- `firebase/firebase.json` — emulator suite configuration (Firestore + Auth) so everything runs locally.

## Run the emulator suite (local verification)

Requirements: Node ≥ 18, Java (JDK 11+), Firebase CLI.

```bash
npm install -g firebase-tools
firebase login
cd firebase
firebase emulators:start --only firestore,auth
```

Then verify the rules:

```bash
# authenticated user A cannot read user B's projects
firebase emulators:exec --only firestore \
  "node ../scripts/firestore-rules-test.mjs"   # (write this test when enabling the Firebase path)
```

## Deploy to a real project

```bash
firebase use --add                     # select your Firebase project
firebase deploy --only firestore:rules,firestore:indexes
```

## When to actually switch the backend to Firestore

Only if/when you want serverless scale-out or the Flutter client reads Firestore directly. The REST API remains the recommended integration surface (it enforces the richer domain rules — state machine, dependency gates, sprint snapshots — that Firestore rules alone cannot express). This split is documented in `docs/IMPLEMENTATION_PLAN.md` → Follow-on backlog.
