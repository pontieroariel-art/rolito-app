---
name: emuladores
description: Desarrollo local seguro con los emuladores de Firestore/Auth (npm run emulators, seed, npm run dev) y qué Cloud Functions NO están emuladas. Usar antes de correr la app en local o probar reglas.
---

# Desarrollo local seguro (emuladores)

`npm run dev` conecta a los emuladores de Firestore/Auth en vez de a producción (`src/services/firebase.ts`, gateado por `import.meta.env.DEV` — no afecta el build de producción). Flujo (requiere Java 21+, igual que `test:rules`):

1. `npm run emulators` — levanta Firestore + Auth emulados (Emulator UI en `http://localhost:4000`; persiste datos entre reinicios en `emulator-data/`, gitignoreado)
2. `npm run seed:emulator` — carga datos mínimos de prueba (staff, choferes, cliente, camiones activos, pedidos) e imprime las credenciales; solo hace falta una vez por sesión de emulador
3. `npm run dev` — la app ya apunta al emulador

**Ojo:** las Cloud Functions (`sendPush`, `notifyCerca`, `notifyReprogramado`, `orsDirections`) no están emuladas — siguen pegándole a las funciones reales desplegadas. En la práctica, confirmar un despacho en local todavía manda una push real a un chofer real.
