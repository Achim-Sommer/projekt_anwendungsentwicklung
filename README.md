# projekt_anwendungsentwicklung
FOM: Projekt: Anwendungsentwicklung

---

## Repository Skeleton – What was created

### Folder structure

```
projekt_anwendungsentwicklung/
├── .gitignore                       # excludes node_modules, dist, .env, *.tsbuildinfo
├── package.json                     # root monorepo (npm workspaces + concurrently)
├── package-lock.json
└── packages/
    ├── shared/                      # Shared TypeScript interfaces
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       └── index.ts             # Socket.IO payload types
    ├── backend/                     # Node.js + Socket.IO server
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       └── server.ts            # minimal server – logs join/leave
    └── frontend/                    # Phaser 3 + Vite app
        ├── index.html
        ├── package.json
        ├── tsconfig.json
        ├── vite.config.ts
        └── src/
            └── main.ts              # 800×600 Phaser canvas + Socket.IO client
```

### Commands to get started

```bash
# Install all deps (monorepo root)
npm install

# Start both backend + frontend in parallel
npm run dev

# Or individually:
npm run dev --workspace=packages/backend   # http://localhost:3000
npm run dev --workspace=packages/frontend  # http://localhost:8080

# Production build (shared → backend → frontend)
npm run build
```

### Key design decisions

| Decision | Detail |
|---|---|
| Strict TypeScript | All packages use `"strict": true` |
| Shared types | `@projekt/shared` exports all Socket.IO event/payload interfaces used by both sides |
| Server-authoritative prep | Backend typed with `Server` |
