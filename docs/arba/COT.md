# COT de ARBA — Código de Operación de Traslado del remito de carga

Pedido de Ariel (2026-09-09/10): el remito de carga del camión tiene que salir con el COT de ARBA
(Provincia de Buenos Aires), como hoy lo hace la oficina a mano en la web de ARBA. Aplica a dos
casos: reparto a clientes (destinatario = un cliente de la zona, como hoy) y traslado entre las
plantas Don Torcuato ↔ Merlo (depósitos propios).

## Normativa (RN ARBA 31/2019 + RN 27/23)

- Obligatorio cuando la carga que sale de origen supera **$9.529.691** (valor 2026, se ajusta cada
  enero por IPC) **o 4.500 kg**, medido sobre la totalidad de la carga sin descontar descargas en
  ruta; o bienes de los Anexos I/II (construcción y minerales — hielo y agua no están).
- Se obtiene **antes** de iniciar el traslado. Vigencia: 1 día para menos de 500 km.
- Art. 8: si el destinatario no se puede individualizar al inicio ("operaciones con información
  parcial"), se informan los destinos dentro de los 4 días corridos posteriores al vencimiento del
  COT (carga manual en la web; el web service TXT no tiene esa modalidad). Hoy la oficina declara un
  cliente de la zona; la app replica eso (caja lo elige de una lista) y deja el traslado a planta
  como opción.
- Traslado entre depósitos propios: carácter "Emisor RG 1415", origen y destinatario con el mismo
  CUIT, importe 0 permitido.
- Sanciones: sin COT → decomiso; datos falsos → multa (arts. 17, 21-22).

## Web service

- `POST https://cot.arba.gov.ar/TransporteBienes/SeguridadCliente/presentarRemitos.do` (prueba:
  `cot.test.arba.gov.ar`, https), multipart con `user` = CUIT, `password` = CIT (clave de transporte
  de ARBA, secret `ARBA_CIT`), `file` = TXT. Respuesta XML ISO-8859-1: `<TBError>` (credenciales,
  formato) o `<validacionesRemitos>` con `<remito><numeroUnico/><procesado/><cot/><errores/></remito>`.
- Verificado 2026-09-10: la CIT de producción autentica (archivo sin remitos → "45 No hay registro
  02"); el ambiente de prueba tiene registro aparte (`www1.test.arba.gov.ar/Registracion/transporteBienes.do`).
- Archivo `TB_<cuit>_<planta><puerta>_<aaaammdd>_<secuencia>.txt`, registros separados por `|`,
  líneas CR+LF: `01|CUIT`, `02|…remito (44 campos)…`, `03|…producto…` (≥1), `04|cantidad`.
  Diseño oficial: "Diseño de archivo TXT — Instructivo Transporte de Bienes" (ARBA, vigente
  05/08/2019). Producto: `CODIGO_UNICO_PRODUCTO` = nomenclador COT / NCM 6 dígitos (hielo 220190,
  agua de mesa 220110), unidad 1 = kilogramos, cantidades con 2 decimales implícitos (3680 kg →
  368000). Comprobante respaldatorio `CODIGO_UNICO` = código AFIP (091 Remito R) + prefijo 5 +
  número 8. Patente obligatoria si el transportista es la propia empresa.
- Tango genera COT solo para remitos/facturas propias; la carga viaja a Tango como transferencia
  entre depósitos, así que el COT lo hace la app.

## Circuito en la app

1. **Config** `config/cot` (Ajustes generales → "COT de ARBA", `components/admin/CotArbaPanel.tsx`,
   `utils/cot.ts` → `normalizarCotConfig`): `habilitado`, `ambiente`, `cuit`, `razonSocial`,
   `umbralKg`, `umbralImporte`, `importePorKg`, `bloqueaSalida`, `respaldo` (código 091 y talonario
   del remito R manual, hoy 00025), `transportista.cuit`, `plantas.{torcuato,merlo}` (planta/puerta del
   archivo, domicilio desglosado, recorrido por defecto) y `productos.{productoId}` (`pesoKg`,
   `codigoArba`, `descripcion`). Los pesos se precargan desde el nombre del producto.
2. **Caja** (`pages/expedicion/RemitosCargaPage.tsx`): la app calcula los kilos de la carga
   (`kgDeItems`); si supera el umbral y la presentación está habilitada aparece el bloque
   `components/expedicion/CotCargaForm.tsx`: reparto (cliente destinatario buscado en el índice, su
   sucursal, domicilio editable, consumidor final, importe) o traslado a la otra planta; remito R que
   respalda (prefijo del talonario + número tipeado), patente del camión, recorrido y salida. Se
   valida (`validarSolicitudCot`) y viaja en `remitosCarga.cotSolicitud` junto con `kg`.
3. **Server** (`functions/src/triggers/cotArba.ts`): `onRemitoCargaCotSolicitado` arma el TXT
   (`services/arba/cot.ts`, puro, con tests contra el COT real 3163824478 del 10/12/2025), lo presenta
   (`services/arba/cotHttp.ts`) y escribe `remitosCarga.cot` (`presentado` con `numero`,
   `numeroUnico`, `archivo`, `txt`, `kg`, `fechaValidez`, o `error` con el motivo). Las reglas de
   `remitosCarga` no dejan crear el doc con `cot`; solo el Admin SDK lo escribe. Reintento: callable
   `presentarCotRemito` (botón en la lista de remitos del día; roles caja/logística/facturación/
   super_admin, 30 por hora).
4. **Papel y control**: el COT se imprime en el encabezado del remito de carga (`utils/pdf.ts`), el
   chofer lo ve en "Mi carga de hoy" y seguridad en el portón; con `bloqueaSalida` el botón "Salió"
   queda deshabilitado mientras falte.

## Pendiente / decisiones

- Modalidad "información parcial" (la legalmente prevista para reparto): hoy no la soporta el web
  service; si el contador la pide, es carga manual en ARBA con la lista de ventas del día por COT.
- El remito R que respalda la carga hoy es el talonario manual 00025; la alternativa es que la app
  numere la carga con su talonario 01105 e imprima el remito R oficial (fase siguiente).
- Registro en el ambiente de prueba de ARBA para homologar sin COT reales.
