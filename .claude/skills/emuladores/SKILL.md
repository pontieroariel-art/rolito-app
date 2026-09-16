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

## Emular un día de ventanilla y tesorería (2026-09-16)

Para practicar el circuito completo de la plata (liquidar choferes y supervisores, cerrar el turno de caja, recibir sobres en tesorería) sin tocar producción, hay un seed que deja el día "a media mañana" y un ARCA de mentira:

1. `npm run emulators` y `npm run seed:emulator` (una vez)
2. `npm run seed:dia` — siembra HOY en Torcuato (`scripts/seed-dia-caja.mjs`): Chofer Uno (depósito 21) volvió con ventas de las dos empresas, un cheque de calle y la descarga contada, listo para liquidar; Chofer Dos (22) sigue en la calle; Supervisor (31) con tres recibos (efectivo Redonhielo, cheque + retención, efectivo Rolito); la caja con turno abierto desde las 07:30, cuatro ventas y una cobranza de mostrador; y un sobre RV de ayer que tesorería no recibió. Idempotente. `npm run seed:dia -- --limpiar` borra todo lo de hoy y ayer del circuito (ventas, cobranzas, turnos, sobres, liquidaciones, descargas, anulaciones) y vuelve a sembrar: sirve para jugar el día de nuevo.
3. `npm run emular:arca` en otra terminal y dejarlo abierto (`scripts/emular-arca.mjs`): a los 3 s de cada venta de contado hecha en la app escribe `factura` con IVA 21 % y CAE inventado (A si el cliente es RI, B si no), y marca `tango.estado = confirmado` en ventas y cobranzas nuevas. Sin esto la ventanilla espera el CAE 45 s y ofrece seguir sin factura, y el "a rendir" no suma el IVA.
4. `npm run dev`. Caja: `/empresa` DNI 20000003 / test1234. Tesorería: DNI 20000011 / test1234. El guion del día lo imprime el seed al terminar.

Lo que NO emula: `tango-consultas` (saldo en vivo del cliente al cobrar: se ve el caché de `saldosTango`), pushes, mails, notas de crédito de anulaciones y `muelleEstado` (las dársenas libres del chofer que vuelve).
