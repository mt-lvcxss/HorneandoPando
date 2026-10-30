# PROMPT MAESTRO DE DESARROLLO
## Aplicación integral de gestión para emprendimientos gastronómicos

**Rol:** Actúa como arquitecto de software, desarrollador full-stack sénior, diseñador de bases de datos, especialista en seguridad, QA y automatización de pruebas. Debes construir una aplicación web real, integrada, mantenible y preparada para evolucionar.

**Objetivo:** desarrollar una plataforma para que emprendedores gastronómicos puedan administrar recetas, ingredientes, compras, inventario, costos, producción, productos terminados, pedidos, ventas, pagos, clientes, devoluciones y resultados operacionales desde un mismo sistema.

No debes limitarte a crear una maqueta, un prototipo visual o una aplicación con datos simulados. El objetivo es construir un producto funcional que utilice persistencia real, aplique las reglas de negocio indicadas, mantenga la integridad de los datos y pueda probarse de principio a fin.

La aplicación debe construirse en el ordenador disponible para el desarrollo, utilizando herramientas locales cuando corresponda. El despliegue inicial puede ejecutarse localmente y utilizar Supabase como backend gestionado. No se comprará un dominio ni se contratará infraestructura adicional antes de comprobar que una primera fase integrada funciona correctamente.

---

# 1. Principios generales del proyecto

## 1.1. Objetivos fundamentales

La aplicación debe cumplir los siguientes objetivos:

1. Permitir que varios emprendedores utilicen la plataforma de forma independiente.
2. Guardar los datos en la nube y permitir acceder a ellos desde distintos dispositivos.
3. Facilitar el control de ingredientes, compras, recetas, costos y producción.
4. Mantener un registro confiable de pedidos, entregas, ventas, pagos, devoluciones y créditos.
5. Calcular costos y resultados sin confundir estimaciones con datos reales.
6. Mantener trazabilidad de las operaciones y sus correcciones.
7. Evitar descuentos duplicados de inventario, pagos duplicados y operaciones concurrentes incompatibles.
8. Ofrecer una interfaz sencilla para personas que no necesariamente tienen conocimientos contables o técnicos.
9. Permitir exportar información y recuperar datos ante fallas.
10. Mantener una arquitectura que permita incorporar posteriormente nuevas funciones sin tener que rehacer el sistema.

## 1.2. Reglas de diseño no negociables

- La aplicación debe ser funcional y estar conectada a una base de datos real.
- Todos los módulos deben compartir un modelo de datos coherente.
- Una misma operación no debe registrarse dos veces por un reintento, un doble clic o una reconexión.
- Los saldos y estados derivados deben poder reconciliarse con sus movimientos de origen.
- Los registros históricos de operaciones confirmadas no deben modificarse silenciosamente.
- Las correcciones económicas y de inventario deben conservar el registro original y crear movimientos correctivos relacionados.
- Las simulaciones no deben alterar inventarios, pagos, ventas ni otros datos operacionales.
- Los datos de un emprendedor nunca deben quedar accesibles para otra cuenta.
- Los formularios deben validar los datos tanto en el frontend como en el backend.
- Las operaciones críticas deben validarse en el servidor y ejecutarse de forma atómica cuando corresponda.
- Los errores deben explicar qué ocurrió y qué puede hacer el usuario para resolverlos.
- La interfaz debe distinguir claramente los datos reales, las estimaciones, los costos incompletos y las valoraciones posteriores.
- No inventar operaciones, compras, costos, conversiones de unidades o movimientos para completar datos faltantes.
- No implementar reglas comerciales o legales arbitrarias que no estén especificadas.
- No sustituir los requisitos funcionales por soluciones simplificadas sin documentar y justificar el cambio.

Cuando exista una decisión funcional definida en este documento, debe respetarse. Si hay una ambigüedad técnica real, identifica el problema, propone una solución conservadora y documenta la decisión antes de incorporarla.

---

# 2. Arquitectura y tecnologías

## 2.1. Arquitectura general

Utiliza inicialmente una arquitectura de monolito modular.

Los módulos deben estar separados por responsabilidad, pero compartir una base de datos y reglas de negocio coherentes. No implementar microservicios en esta etapa, salvo que exista una razón técnica demostrable y aprobada.

La arquitectura debe separar:

- Interfaz de usuario.
- Lógica de negocio.
- Acceso a datos.
- Autenticación y autorización.
- Procesamiento de operaciones críticas.
- Tareas programadas.
- Auditoría.
- Exportaciones.
- Gestión de errores.
- Integraciones externas.

Las reglas críticas no deben depender exclusivamente de componentes de interfaz ni de cálculos ejecutados solo en el navegador.

## 2.2. Tecnologías preferidas

Como propuesta inicial, utiliza:

- **Frontend:** React con TypeScript.
- **Herramienta de desarrollo y compilación:** Vite.
- **Estilos:** CSS organizado, diseño responsive y componentes reutilizables.
- **Aplicación instalable:** PWA.
- **Base de datos:** PostgreSQL.
- **Backend gestionado de referencia:** Supabase.
- **Autenticación:** Supabase Auth, con la configuración adicional necesaria para cumplir los requisitos.
- **Migraciones:** SQL versionado y reproducible.
- **Pruebas:** pruebas unitarias, integración, seguridad, flujos completos y concurrencia.
- **Control de versiones:** Git.
- **Automatización:** pipeline de compilación y pruebas, inicialmente mediante GitHub Actions u otra alternativa compatible.

Estas tecnologías son la opción preferida, no una excusa para ignorar las capacidades reales del entorno de desarrollo. Antes de implementar, comprueba las herramientas instaladas y las restricciones del generador o agente que se utilizará. Si necesitas cambiar una tecnología, justifica el cambio y conserva los requisitos funcionales y de seguridad.

## 2.3. Supabase y servicios externos

Supabase será la primera alternativa para:

- PostgreSQL.
- Autenticación.
- Políticas de acceso a datos.
- Servicios de backend compatibles.
- Funciones de servidor cuando sean necesarias.
- Almacenamiento, si posteriormente se requieren archivos o adjuntos.

El uso de Supabase no debe significar que todas las reglas de negocio deban implementarse directamente en el frontend.

Evalúa las transacciones SQL, las funciones del servidor y las restricciones de PostgreSQL para implementar operaciones críticas.

No contratar servicios innecesarios en la primera etapa. Prioriza alternativas gratuitas o de bajo costo que cumplan los requisitos reales de seguridad, disponibilidad, almacenamiento y recuperación.

No asumir que un plan gratuito satisface todos los requisitos. Documenta límites relevantes y verifica los costos actuales antes de utilizar un servicio en producción.

## 2.4. Gestión de credenciales

- Mantener claves secretas fuera del código fuente.
- Utilizar variables de entorno.
- Crear un archivo de ejemplo de configuración sin credenciales reales.
- No subir secretos al repositorio.
- No incluir la clave `service_role` de Supabase en el frontend.
- Utilizar la clave pública de Supabase únicamente junto con las políticas de acceso adecuadas.
- No almacenar contraseñas en texto plano.
- No registrar tokens de recuperación, contraseñas ni información sensible en logs.

---

# 3. Usuarios, cuentas y aislamiento de información

## 3.1. Modelo de cuentas

La plataforma tendrá dos clases de acceso:

1. Emprendedores gastronómicos.
2. Administradores técnicos de la plataforma.

En la primera versión, cada emprendedor tendrá una cuenta individual. No se necesitan múltiples usuarios ni roles internos por negocio.

El titular de una cuenta podrá administrar todos los módulos y datos correspondientes a su negocio.

No implementar todavía invitaciones de empleados, permisos por trabajador ni administración multiusuario de un mismo negocio.

## 3.2. Registro de emprendedores

El registro estará abierto a nuevos emprendedores.

El formulario inicial solicitará únicamente:

- Correo electrónico.
- Contraseña.

Una vez confirmada la cuenta, el usuario completará la configuración del negocio, incluyendo el nombre comercial y los datos necesarios para personalizar la aplicación.

La configuración inicial podrá retomarse posteriormente. No exigir completar todos los datos del negocio para comenzar a utilizar las funciones disponibles.

## 3.3. Autenticación

Implementar:

- Registro.
- Confirmación obligatoria del correo antes del acceso normal al negocio.
- Inicio y cierre de sesión.
- Recuperación de contraseña.
- Restablecimiento mediante enlace seguro, de uso único y con vencimiento.
- Gestión segura de sesiones.
- Verificación adicional al iniciar sesión desde un dispositivo o navegador nuevo.
- Mensajes de error que no revelen si una cuenta ajena existe.
- Protección contra intentos repetidos y abuso de los flujos de autenticación.

La verificación adicional por nuevo dispositivo debe diseñarse expresamente. No asumir que Supabase la implementa automáticamente en la forma requerida.

La solución puede utilizar un enlace de verificación o un código enviado por correo. Debe ser seguro, tener una vigencia limitada, impedir la reutilización y no permitir que conocer una dirección IP sea suficiente para acreditar identidad.

Las sesiones deben expirar por inactividad:

- Panel de administración: 30 minutos.
- Cuenta de emprendedor: 60 minutos.

Cuando corresponda, avisar al usuario antes de perder el trabajo no guardado y conservar los borradores que puedan recuperarse de manera segura.

## 3.4. Aislamiento de cuentas

Este requisito es crítico.

Cada registro operacional debe pertenecer inequívocamente a una cuenta o negocio.

Implementar aislamiento en el backend y la base de datos, no solo ocultando información en la interfaz.

En Supabase, utilizar Row Level Security (RLS) en todas las tablas accesibles por los clientes, junto con políticas que verifiquen la pertenencia real de los registros al usuario autenticado.

No confiar en un `account_id` enviado desde el navegador sin validarlo.

Las operaciones de servidor también deben comprobar la autorización. Las funciones privilegiadas deben minimizarse y nunca permitir acceso transversal sin autorización.

Crear pruebas que demuestren que una cuenta no puede:

- Consultar datos de otra.
- Modificar datos de otra.
- Exportar datos de otra.
- Acceder a registros mediante identificadores conocidos.
- Crear movimientos relacionados con entidades de otra cuenta.
- Acceder a información de otros negocios mediante relaciones indirectas.

---

# 4. Administrador técnico de la plataforma

## 4.1. Acceso separado

El administrador tendrá un panel independiente del área de emprendedores.

No debe utilizar una cuenta normal de emprendedor para obtener privilegios administrativos.

La autorización administrativa debe estar validada en el servidor y no depender de un campo modificable por el cliente.

## 4.2. Responsabilidades

El panel debe permitir:

- Supervisar el funcionamiento técnico.
- Consultar el estado de respaldos.
- Revisar errores e incidentes.
- Consultar alertas.
- Gestionar cuentas activas, inactivas y cerradas.
- Revisar tareas de recuperación.
- Supervisar exportaciones administrativas.
- Consultar información limitada para resolver problemas.
- Registrar decisiones y correcciones técnicas.
- Consultar indicadores sobre abandono de cuentas y comentarios pendientes.

No construir un panel que permita editar libremente todos los datos comerciales de los emprendedores.

## 4.3. Acceso administrativo a datos

El administrador puede acceder a información de una cuenta para resolver incidencias técnicas sin autorización previa del emprendedor, pero debe registrar obligatoriamente:

- Administrador responsable.
- Fecha y hora.
- Cuenta afectada.
- Motivo.
- Alcance de la consulta.
- Acciones realizadas.
- Referencia al incidente, cuando corresponda.

Los motivos disponibles serán:

- Consulta de datos por ticket.
- Revisión por error en datos.
- Investigación de error técnico.
- Verificación de inconsistencia entre módulos.
- Revisión de problema de sincronización.
- Verificación de respaldo o restauración.
- Revisión de incidente de seguridad.
- Solicitud de soporte del emprendedor.
- Otros, con explicación obligatoria.

Las consultas sin modificaciones deben quedar auditadas. Si se realiza una corrección técnica, debe notificarse al emprendedor dentro de la aplicación.

El administrador puede corregir problemas técnicos de datos mediante procedimientos controlados. Las correcciones comerciales, precios, pagos y decisiones propias del negocio corresponden al emprendedor, mediante sus operaciones normales o movimientos correctivos.

## 4.4. Incidentes

Utilizar un registro de incidentes compartido por el equipo administrativo y técnico.

- El administrador gestiona incidentes de datos y restauración.
- El equipo técnico resuelve defectos de código y aplicación.
- Ambos deben poder relacionar sus acciones con el mismo incidente.
- Un incidente no se considera resuelto únicamente porque se haya enviado una notificación.

---

# 5. Correo electrónico y autenticación

## 5.1. Primera fase

Utilizar Supabase Auth como primera alternativa de autenticación.

Para pruebas, evaluar el servicio de correo que proporciona Supabase, verificando los límites y condiciones vigentes.

La aplicación debe permitir configurar de manera desacoplada el mecanismo de envío de correo, para no tener que modificar los flujos de negocio si posteriormente se utiliza un proveedor SMTP.

## 5.2. Alternativas de correo

Considerar:

1. Servicio de correo integrado de Supabase para desarrollo y pruebas.
2. Resend, si su plan gratuito, límites y capacidades son adecuados.
3. Otro proveedor SMTP compatible, si existe una razón técnica o económica para utilizarlo.

No asumir que el plan gratuito de Resend es permanente ni suficiente. Verificar sus condiciones actuales antes de depender de él.

No exigir un dominio propio para la primera fase local. Para una futura versión pública, documentar los requisitos habituales de autenticación del remitente, verificación de dominio y registros DNS.

Mantener configurables las URL de retorno y redirección de autenticación para desarrollo, pruebas y producción.

## 5.3. Correos necesarios

Preparar plantillas para:

- Confirmación de registro.
- Recuperación de contraseña.
- Verificación adicional de acceso cuando corresponda.
- Notificaciones técnicas que expresamente deban enviarse por correo.

Los correos deben tener contenido claro, enlaces seguros y una vigencia definida cuando incluyan tokens.

No incluir contraseñas ni datos financieros sensibles.

Las notificaciones de incidencias de respaldo deben dirigirse al administrador de la plataforma, no a los emprendedores.

Los errores de envío no deben perder la incidencia original ni crear notificaciones duplicadas.

---

# 6. Datos del negocio y configuración inicial

El usuario debe poder configurar progresivamente su negocio.

Datos sugeridos:

- Nombre del negocio.
- Información básica de contacto, si desea registrarla.
- Preferencias de inventario.
- Preferencias de recetas y producción.
- Criterios de costos y precios.
- Preferencias de ventas y pagos.
- Configuración de pedidos y entregas.
- Notificaciones.
- Informes y exportaciones.

La moneda de trabajo será el peso chileno (CLP).

No implementar una contabilidad formal ni asumir requisitos tributarios que no estén especificados.

La aplicación debe mostrar fechas y horas de manera consistente con la zona horaria configurada para el negocio. Almacenar internamente las fechas temporales con una estrategia coherente y evitar errores al cambiar de dispositivo o zona horaria.

---

# 7. Ingredientes y catálogo de inventario

## 7.1. Catálogo

Permitir registrar ingredientes con:

- Nombre.
- Categoría.
- Marca, cuando corresponda.
- Presentaciones comerciales.
- Unidad de medida.
- Cantidad por envase.
- Precios de referencia.
- Historial de compras.
- Configuración de stock mínimo.

Un ingrediente puede tener varias marcas y presentaciones. Por ejemplo, harina de distintas marcas y en envases de diferentes tamaños.

No tratar todas las presentaciones como si tuvieran automáticamente el mismo costo por unidad.

## 7.2. Inventario por envase

El inventario debe identificar cada envase o unidad física de compra.

Ejemplo:

- Envase A: cantidad inicial de 1.000 g, saldo de 800 g.
- Envase B: cantidad inicial de 1.000 g, saldo de 350 g.

Cada envase debe conservar su relación con la compra, el precio, la cantidad inicial, el saldo y los movimientos que lo afectaron.

Los saldos deben poder reconstruirse o reconciliarse con los movimientos registrados.

## 7.3. Tipos de movimiento

Distinguir como mínimo:

- Compra o entrada por compra.
- Entrada manual de inventario.
- Consumo por producción.
- Ajuste de inventario.
- Merma o pérdida.
- Devolución a proveedor.
- Reversión o corrección de una operación.
- Movimientos relacionados con productos terminados, cuando el seguimiento esté habilitado.

No registrar una compra ficticia cuando el usuario solamente necesita corregir el saldo.

Los ajustes manuales deben registrar cantidad, fecha y motivo opcional. Deben conservarse tanto el estado anterior como el movimiento correctivo.

## 7.4. Asignación de envases para producción

Al calcular una producción, proponer los envases de los cuales se consumirán ingredientes.

El criterio inicial será:

1. Priorizar envases abiertos.
2. Después utilizar envases cerrados.
3. Intentar reducir el número de envases abiertos simultáneamente.
4. En igualdad de condiciones, priorizar el envase con la fecha de compra más antigua.

La propuesta debe ser editable antes de confirmar una producción real.

Al modificar la asignación, recalcular el costo estimado según los precios de los envases seleccionados.

Validar que:

- La cantidad asignada cubra la necesidad calculada.
- Ningún envase tenga consumo superior a su saldo.
- Ningún saldo quede negativo.
- No se mezclen unidades incompatibles sin una conversión válida.

## 7.5. Stock insuficiente

Durante una simulación, permitir calcular aunque falte inventario. Mostrar los ingredientes y cantidades faltantes.

Durante una producción real, bloquear la confirmación si el stock no es suficiente.

Ofrecer dos alternativas:

- Ir al inventario para registrar una compra, entrada o corrección.
- Elegir otra receta.

No implementar sustituciones automáticas de ingredientes en esta versión.

## 7.6. Compras

Registrar:

- Ingrediente.
- Marca y presentación.
- Número y cantidad de envases.
- Precio de lista.
- Precio efectivamente pagado.
- Cantidad incorporada al inventario.
- Fecha.
- Cargos adicionales.
- Referencia libre opcional.

Al guardar una compra, el stock aumenta inmediatamente.

Si posteriormente se detecta una diferencia entre la compra registrada y la cantidad efectivamente recibida, se debe corregir mediante un movimiento adicional y trazable.

Se puede ofrecer un estado de compra pendiente de verificación para ayudar a detectar diferencias, pero no impedir el registro del inventario ya incorporado.

## 7.7. Costos adicionales de compras

Permitir registrar transporte, despacho y otros cargos.

Para cada cargo, el usuario elegirá si:

- Se registra como gasto separado.
- Se distribuye entre los productos de la compra.

Si se distribuye, permitir seleccionar el criterio:

- Proporcional al valor de compra.
- Proporcional a la cantidad física, cuando las unidades sean comparables.
- Otro criterio definido y documentado que pueda aplicarse de forma coherente.

Mostrar el resultado de la distribución antes de confirmar.

Guardar el cargo original, el método utilizado y las asignaciones resultantes. Evitar contabilizar el mismo importe dos veces.

El usuario debe configurar si esos cargos participan en:

- Costo histórico.
- Costo de reposición.
- Ambos, manteniendo las valoraciones diferenciadas.

Para un envase consumido parcialmente, permitir configurar por cargo si el costo adicional se distribuye proporcionalmente al consumo, se carga íntegramente en el primer uso o utiliza otra regla definida por el usuario.

## 7.8. Devoluciones a proveedores

Permitir devoluciones relacionadas con una compra y, excepcionalmente, devoluciones sin compra asociada.

Registrar cantidades, fecha, motivo y referencias disponibles.

La devolución reduce el inventario según el movimiento confirmado, sin generar saldos negativos.

Si la operación afecta compras o consumos anteriores, no borrar su historial. Resolver el impacto mediante movimientos correctivos.

## 7.9. Conteo físico

Permitir contar inventario por envase individual.

El usuario podrá realizar conteos parciales y consultar una vista consolidada por ingrediente.

Comparar cantidad física declarada con saldo del sistema, mostrar la diferencia y solicitar confirmación antes de registrar el ajuste.

## 7.10. Alertas de inventario

Permitir configurar un mínimo de stock por ingrediente.

Mostrar alertas dentro de la aplicación cuando se alcance el mínimo y avisos de faltantes cuando una producción planificada no pueda realizarse.

Las alertas deben cerrarse cuando se resuelva la condición. Si la condición reaparece después de haberse resuelto, crear una nueva alerta y conservar el historial.

No generar alertas duplicadas por una misma condición que continúa activa.

---

# 8. Recetas y versiones

## 8.1. Datos de una receta

Cada receta puede contener:

- Nombre.
- Descripción.
- Ingredientes.
- Cantidades.
- Unidades de medida.
- Rendimiento teórico.
- Instrucciones opcionales.
- Costos asociados.
- Versiones.
- Estado.

La receta debe poder trabajar con unidades, peso o volumen, siempre que las cantidades y unidades sean coherentes.

## 8.2. Ajuste de cantidades

Ofrecer dos métodos:

**Manual:** el emprendedor modifica las cantidades según su criterio.

**Automático:** el emprendedor introduce el rendimiento deseado y el sistema escala proporcionalmente los ingredientes.

Conservar los decimales calculados. No redondear automáticamente para hacer que una receta parezca más práctica.

Ejemplo: una receta para 12 porciones que utiliza 3 huevos, escalada a 10 porciones, puede producir un cálculo de 2,5 huevos. La aplicación debe mostrar el cálculo exacto y permitir que el emprendedor decida cómo ejecutarlo.

## 8.3. Tipos de modificación

Permitir:

1. Ajustes temporales para una simulación o producción.
2. Modificar la receta original mediante una nueva versión vigente.
3. Crear una versión alternativa que preserve la formulación base.

Cada receta tendrá una versión vigente propuesta automáticamente. El usuario podrá seleccionar otra versión existente para una simulación o producción.

## 8.4. Historial

Nunca modificar retroactivamente una producción confirmada porque se cambió la receta.

Registrar en cada producción:

- Versión utilizada.
- Cantidades calculadas.
- Ajustes manuales.
- Consumo real.
- Costos asociados.
- Rendimiento conocido, si corresponde.

Las versiones antiguas deben poder consultarse y conservar sus formulaciones.

Cada versión puede tener un costo diferente.

---

# 9. Costos de producción

## 9.1. Componentes

El costo de preparación o producción puede incluir:

- Ingredientes.
- Mano de obra.
- Envases y embalajes.
- Etiquetas.
- Materiales de presentación.
- Otros costos adicionales registrados por el emprendedor.

No incluir automáticamente los gastos generales del negocio en el costo unitario de las recetas.

## 9.2. Costo de ingredientes

Calcular el costo del consumo real según los envases utilizados y el costo unitario derivado de su compra.

No calcular el costo histórico utilizando indiscriminadamente el precio más reciente del catálogo.

Cada producción debe conservar una valoración histórica que no cambie cuando se actualicen los precios.

## 9.3. Ingredientes sin costo conocido

Si un ingrediente no tiene costo de compra conocido:

- Permitir simulaciones con advertencia.
- Permitir registrar un costo provisional explícito.
- Permitir realizar producción real si el inventario físico es suficiente.
- Marcar el costo histórico como incompleto cuando corresponda.
- Nunca interpretar un costo desconocido como cero o como ingrediente gratuito.

Cuando posteriormente se conozca el costo, permitir una valoración corregida conservando la original, la nueva valoración, la fecha y el motivo.

Mostrar como principal el costo original registrado y, por separado, la última valoración corregida y el historial completo.

## 9.4. Mano de obra

Permitir registrar mano de obra por producción completa o por unidad.

El usuario debe elegir el método.

La simulación puede utilizar un costo estimado. La producción real puede registrar el costo efectivo.

Si el costo no está disponible, permitir continuar cuando las demás reglas lo permitan, pero marcarlo como incompleto y advertir que el resultado excluye la mano de obra no registrada.

No calcular automáticamente horas por tarifa horaria en esta versión.

## 9.5. Gastos generales

Registrar por separado gastos como:

- Electricidad.
- Agua.
- Arriendo.
- Internet.
- Otros gastos generales.

Cada registro debe contener descripción, importe en CLP, fecha y categoría.

Mostrar estos gastos en informes financieros, sin distribuirlos automáticamente entre recetas ni sumarlos de forma oculta al costo unitario.

## 9.6. Costo teórico y costo real

Distinguir:

- Costo teórico de la receta.
- Costo estimado de la simulación.
- Costo histórico de la producción real.
- Costo corregido mediante una revaloración.
- Costo de reposición actual.

El costo unitario teórico se basa en el rendimiento teórico.

Cuando se conozcan las cantidades producidas y su destino, calcular también el costo asignado a las unidades vendidas o entregadas, las unidades que quedan en inventario y las mermas.

No sustituir silenciosamente un costo por otro.

Si el seguimiento de productos terminados está deshabilitado y no se conoce el rendimiento real, no presentar un costo unitario real exacto como si se hubiera medido.

## 9.7. Revaloración de producciones históricas

Cuando se registren precios nuevos, detectar producciones históricas potencialmente afectadas y avisar al usuario.

No recalcular automáticamente el historial.

El usuario seleccionará qué producciones desea revalorar.

Priorizar precios históricos verificables. Si no pueden verificarse, permitir utilizar un costo de reposición claramente identificado como estimación, no como costo histórico real.

## 9.8. Criterio de costo de reposición

Permitir configurar un criterio global y excepciones por ingrediente.

Opciones iniciales:

- Precio de la compra más reciente.
- Menor costo por unidad de medida comparable.

Mostrar el criterio utilizado, la presentación, el precio de referencia y la fecha disponible.

Si no se puede aplicar el criterio seleccionado por falta de datos, solicitar al usuario que elija otro criterio para ese cálculo. No cambiarlo silenciosamente.

Si ningún criterio puede calcular el costo, ofrecer completar los datos del ingrediente o introducir un costo provisional.

Los costos provisionales pueden ser puntuales o guardarse para futuras estimaciones, a elección del usuario.

Cuando exista un precio real verificable y un costo provisional, priorizar el precio real si hay datos suficientes para aplicar el criterio configurado. Utilizar el costo provisional como alternativa solo cuando los datos sean insuficientes y mostrar una advertencia.

## 9.9. Equivalencias de precios

Para comparar presentaciones, utilizar unidades equivalentes válidas.

El emprendedor podrá definir equivalencias manualmente o confirmar una sugerencia del sistema.

Las equivalencias deben ser específicas y reutilizables cuando corresponda.

Modificar una equivalencia no debe cambiar retrospectivamente operaciones históricas.

Una equivalencia de precio no autoriza a sustituir automáticamente un ingrediente por otro.

---

# 10. Simulaciones y producción real

## 10.1. Simulación

Una simulación estima:

- Cantidades de ingredientes.
- Envases necesarios.
- Faltantes.
- Costos.
- Mano de obra.
- Embalajes.
- Otros costos.
- Precio sugerido, si se solicita.
- Resultados estimados.

La simulación no debe modificar inventarios, registrar consumos ni crear ventas.

Conservarla como referencia histórica con la receta y versión utilizadas, las cantidades, los ajustes, los costos estimados y los faltantes identificados.

## 10.2. Producción real

La producción real debe:

1. Seleccionar receta y versión.
2. Calcular cantidades necesarias.
3. Proponer envases para consumo.
4. Permitir ajustes válidos de la asignación.
5. Mostrar cantidades y costos actualizados.
6. Comprobar inventario disponible.
7. Solicitar confirmación.
8. Registrar la producción.
9. Registrar consumos reales por envase.
10. Crear movimientos de inventario.
11. Registrar cantidades producidas y destinos cuando corresponda.
12. Conservar la información histórica.

La validación final de stock, el registro de producción y la deducción de ingredientes deben ejecutarse de manera atómica.

No basta con comprobar el stock en el navegador antes de guardar.

## 10.3. Reutilizar simulaciones

Una simulación puede utilizarse para iniciar varias producciones.

Cada producción debe tener un registro independiente, una validación de stock propia, cantidades confirmadas y consumos reales.

Antes de confirmar una producción basada en una simulación, volver a validar inventario y actualizar la propuesta según las condiciones actuales.

Permitir modificar cantidades antes de confirmar. Mostrar diferencias respecto de la simulación original y guardar la propuesta final confirmada.

No reservar ingredientes por el simple hecho de crear una simulación.

## 10.4. Concurrencia

Si dos dispositivos intentan producir utilizando el mismo inventario:

- Las operaciones deben validarse en el servidor.
- Las actualizaciones deben ejecutarse con control de concurrencia.
- Una operación no debe consumir cantidades ya utilizadas por otra.
- Si el stock deja de ser suficiente, la operación incompatible debe fallar de forma controlada.
- No se deben generar saldos negativos.
- No se deben crear producciones duplicadas por reintentos.

Utilizar transacciones, restricciones y mecanismos de concurrencia apropiados en PostgreSQL.

No aplicar bloqueos innecesarios a todas las operaciones. Utilizar el mecanismo adecuado para cada recurso y documentar las decisiones.

---

# 11. Inventario de productos terminados

El seguimiento de productos terminados será configurable por negocio.

## 11.1. Cuando está habilitado

Registrar:

- Cantidad producida.
- Unidades disponibles.
- Unidades reservadas.
- Unidades vendidas o entregadas.
- Mermas.
- Otras salidas justificadas.

Distinguir inventario físico, reservado y disponible.

Cuando se conozca la producción real, el emprendedor debe indicar el rendimiento real y el destino de las unidades relevantes.

No devolver automáticamente sobrantes al inventario sin confirmación.

## 11.2. Destino de sobrantes

Para las unidades sobrantes de una producción, ofrecer:

- Devolver a stock disponible.
- Reservar para otro pedido.
- Registrar como merma.

Solicitar confirmación antes de actualizar inventario.

Relacionar el destino con la producción o pedido de origen cuando corresponda.

## 11.3. Cuando está deshabilitado

Permitir registrar producciones, pedidos y ventas sin mantener un saldo operacional de productos terminados.

Conservar el historial de las operaciones.

Mostrar una advertencia cuando no sea posible comprobar la disponibilidad física de productos terminados.

No crear reservas operacionales ni afirmar que se conoce la disponibilidad de stock en esta modalidad.

---

# 12. Pedidos y entregas

## 12.1. Diferencia entre pedido y venta

Un pedido representa un compromiso comercial.

Una venta representa unidades efectivamente entregadas conforme a las reglas del negocio.

No registrar automáticamente toda la cantidad de un pedido como venta al confirmarlo.

Las cantidades no entregadas no generan ingresos por venta.

## 12.2. Flujo del pedido

El flujo general debe contemplar:

1. Crear pedido.
2. Revisar disponibilidad cuando corresponda.
3. Confirmar condiciones comerciales.
4. Preparar o asignar productos.
5. Registrar producción si es necesaria.
6. Registrar una o más entregas.
7. Registrar pagos y saldo.
8. Consultar resultados financieros.
9. Cerrar el pedido cuando corresponda.

Los pedidos pueden ser borradores o confirmados sin bloquear inventario.

## 12.3. Reservas

Reservar unidades terminadas al comenzar la preparación, no al crear o confirmar el pedido.

Antes de reservar, mostrar una propuesta y solicitar confirmación.

Comprobar nuevamente la disponibilidad antes de aplicar la reserva. Si cambió, actualizar la propuesta y explicar las diferencias.

Cuando el seguimiento de productos terminados esté deshabilitado, no crear reservas operacionales y advertir que la disponibilidad no puede verificarse desde el inventario.

## 12.4. Preparación y asignación

La producción puede vincularse directamente a un pedido específico o destinarse a stock general, a elección del emprendedor.

Si se prepara un pedido y se reservan unidades, impedir que esas unidades se asignen a otro pedido.

## 12.5. Entregas parciales

Permitir varias entregas para un mismo pedido.

Registrar por separado:

- Cantidad solicitada.
- Cantidad producida.
- Cantidad entregada.
- Cantidad pendiente.
- Cantidad pendiente de resolución.
- Cantidad cerrada como no entregada.

Un pedido puede cerrarse por una cantidad menor a la solicitada, siempre que el emprendedor indique la cantidad no entregada y el motivo.

## 12.6. Precio y descuentos

Conservar el precio y descuento acordados al confirmar el pedido, incluso si cambia el precio del catálogo posteriormente.

Los cambios comerciales posteriores solo deben aplicarse cuando el emprendedor los registre expresamente, conservando el valor anterior, el nuevo, la fecha y el motivo.

Permitir distribuir manualmente un descuento total entre entregas parciales.

Validar que la suma de los descuentos aplicados no supere el descuento acordado y que los importes sean coherentes con las entregas.

Los descuentos ya aplicados a ventas anteriores no se modifican. Solo se puede ajustar la distribución todavía no aplicada.

## 12.7. Confirmación de entrega

Confirmar una entrega debe generar automáticamente la venta correspondiente a las cantidades entregadas, con los precios y descuentos aplicables.

La entrega debe actualizar las reservas y el inventario según corresponda, sin deducir dos veces las mismas unidades.

Las entregas anteriores no deben reescribirse cuando cambien las cantidades pendientes de un pedido.

## 12.8. Cambios y cancelaciones

Al reducir o cancelar un pedido después de iniciar la preparación, mostrar las unidades afectadas y solicitar una decisión explícita sobre su destino:

- Devolver unidades intactas al stock disponible, si el seguimiento está habilitado.
- Reservarlas para otro pedido.
- Registrarlas como merma.

No liberar reservas ni devolver unidades al stock automáticamente sin confirmación.

Las unidades ya entregadas o consumidas no pueden devolverse al inventario como si estuvieran intactas.

Antes de confirmar una cancelación, mostrar:

- Pagos recibidos.
- Cantidades producidas y entregadas.
- Costos incurridos.
- Reservas.
- Sobrantes.
- Saldos pendientes.
- Posibles devoluciones o créditos.

Las cancelaciones deben seguir un proceso guiado.

## 12.9. Cierre incompleto

Cuando el emprendedor cierre un pedido por una cantidad inferior a la solicitada, debe indicar la cantidad no entregada y el motivo.

Resolver las reservas y los sobrantes por separado.

No interpretar el cierre como una orden para borrar producción, consumos o ventas anteriores.

---

# 13. Ventas directas

Permitir registrar una venta directa sin crear previamente un pedido formal.

Confirmar una venta directa representa la operación comercial y la entrega de las unidades indicadas.

Cuando el seguimiento de productos terminados esté habilitado:

- Comprobar el stock.
- Bloquear la venta si no existe cantidad suficiente.
- Mostrar el faltante.
- Permitir reducir la cantidad o registrar una producción real y volver a intentar la venta.
- Descontar el stock al confirmar la venta.

Cuando esté deshabilitado, permitir registrar la venta, pero advertir que la disponibilidad no se puede verificar mediante un saldo operacional.

Si la venta proviene de un pedido o entrega existente, no registrar una segunda venta ni volver a descontar las mismas unidades.

---

# 14. Clientes

La identificación de clientes será opcional para las ventas directas. Permitir ventas anónimas.

Cuando se registre un cliente, permitir:

- Nombre o identificador.
- Teléfono opcional.
- Correo electrónico opcional.
- Una o más direcciones de entrega.
- Notas de uso futuro.

La ficha e historial del cliente deben ser privados de la cuenta del emprendedor.

Mostrar un historial consolidado de:

- Pedidos.
- Ventas.
- Pagos pendientes.
- Créditos.
- Reclamos.

La ficha no debe duplicar los registros financieros originales.

Cambiar una dirección o una nota guardada no debe modificar automáticamente pedidos ya confirmados.

---

# 15. Pagos, saldos y créditos

## 15.1. Pagos

Permitir registrar:

- Anticipos.
- Abonos parciales.
- Pagos finales.
- Fecha.
- Importe.
- Método, opcional.
- Nota, opcional.
- Pedido relacionado.

Los pagos se vinculan al pedido completo, no a una entrega específica.

Cada pedido tendrá un total pagado y un saldo pendiente, mientras que las entregas se registrarán de forma independiente.

Permitir pedidos entregados con saldo pendiente y pagos recibidos antes de producir.

## 15.2. Ingresos, ventas y beneficios

No confundir:

- Dinero recibido.
- Ingresos por ventas.
- Costo de producción.
- Costos de venta.
- Beneficio estimado.
- Cuentas por cobrar.

Un anticipo recibido antes de la entrega se registra como dinero recibido, pero no como venta por unidades todavía no entregadas.

## 15.3. Modificación de importes

No modificar silenciosamente pagos confirmados.

Los reembolsos y ajustes financieros deben generar movimientos nuevos relacionados con el pago original.

Si se cancela o reduce un pedido y el total pagado supera el nuevo importe, mostrar el excedente y solicitar que el emprendedor decida entre:

- Reembolsar.
- Mantener el importe como retención justificada.
- Generar un crédito para el cliente.

Solicitar importe, motivo y confirmación.

No asumir que legalmente corresponde retener un anticipo o depósito. Mostrar la política configurada por el negocio y requerir justificación cuando se aplique una excepción.

## 15.4. Créditos de clientes

Los créditos deben tener:

- Identificador único.
- Importe original.
- Saldo disponible.
- Fecha.
- Motivo.
- Pedido de origen.
- Referencia opcional al cliente o contacto.
- Historial de aplicaciones y devoluciones.
- Fecha de vencimiento opcional.

No crear una cuenta corriente permanente de cliente.

El emprendedor seleccionará manualmente el crédito y el importe a aplicar a otro pedido. Permitir aplicaciones parciales y en varias operaciones, evitando utilizar más crédito del disponible.

Aplicar un crédito no constituye un nuevo ingreso de efectivo ni una nueva venta.

Si existe vencimiento, marcar el crédito como vencido y notificar al usuario, pero no bloquearlo ni eliminarlo automáticamente.

La aplicación no debe inferir automáticamente consecuencias legales de un vencimiento.

---

# 16. Devoluciones, reclamos y correcciones

## 16.1. Devoluciones de clientes

Registrar la devolución y su relación con la venta original.

Solicitar el destino de las unidades devueltas:

- Volver a stock.
- Reservar para otro pedido.
- Registrar como merma.

Si no existe seguimiento operacional de productos terminados, conservar el historial sin crear un saldo físico ficticio.

La resolución financiera debe ser explícita:

- Reembolso.
- Crédito.
- Otra solución documentada.

El reembolso debe ser un movimiento nuevo vinculado al pago original. No modificar el pago inicial.

## 16.2. Reclamos sin devolución física

Permitir registrar reclamos vinculados a una venta sin exigir una devolución física.

Guardar motivo, estado y resolución.

No generar movimientos financieros o de inventario si el emprendedor no confirma expresamente una acción que los justifique.

## 16.3. Correcciones de operaciones

Las operaciones confirmadas no se deben editar libremente.

Si una entrega tiene diferencias parciales, registrar los ajustes correspondientes.

Si una operación completa fue inválida, permitir revertirla y volver a registrarla correctamente.

Preservar el registro original, el motivo, la fecha y la relación entre la operación inicial y la correctiva.

Los saldos deben actualizarse mediante movimientos trazables y reconciliables.

---

# 17. Precios y costos de venta

## 17.1. Métodos de precio

Permitir calcular precios mediante:

- Markup sobre costo.
- Margen objetivo.

Recordar el último método utilizado por el emprendedor, permitiendo cambiarlo por operación.

No confundir markup con margen.

Mostrar claramente el costo utilizado, el método, el porcentaje, el precio resultante y el margen estimado.

## 17.2. Descuentos

Permitir descuentos manuales por importe en CLP o porcentaje.

Mostrar y conservar:

- Precio original.
- Descuento.
- Precio final.

## 17.3. Costos de venta

Permitir registrar costos fijos y porcentuales por venta.

El usuario podrá seleccionar qué costos se aplican a cada operación.

La base de cálculo de un costo porcentual será el importe después del descuento y antes de descontar la propia comisión.

Los cambios en comisiones o costos de venta se aplicarán a futuras operaciones, no a las ventas históricas.

## 17.4. Resultados de venta

Mostrar resumen y detalle por operación con:

- Ingreso por venta.
- Descuentos.
- Costo de producción asignado.
- Costos de venta.
- Beneficio estimado.

Si faltan costos relevantes, advertirlo.

No presentar el beneficio estimado como resultado contable neto.

---

# 18. Distribución del costo de producción

Cuando una producción tenga unidades entregadas, unidades en stock y mermas, distribuir su costo de manera coherente entre los destinos conocidos.

Ejemplo:

Una producción de 30 unidades cuesta $15.000 CLP.

- 20 unidades vendidas o entregadas: $10.000.
- 6 unidades restantes en stock: $3.000.
- 4 unidades registradas como merma: $2.000.

El total asignado debe reconciliar con el costo de producción.

Utilizar el costo unitario derivado de la producción real y la cantidad real conocida.

No repartir costos de forma arbitraria cuando falten cantidades. Marcar el resultado como incompleto o pendiente de información.

Si posteriormente se corrige el rendimiento o la valoración, conservar el cálculo original y registrar la nueva valoración por separado.

---

# 19. Cancelaciones, reembolsos y efectos financieros

## 19.1. Política por negocio

Permitir configurar la política de anticipos, cancelaciones y saldos.

Mostrar la política aplicable al confirmar una cancelación.

Si se aplica una excepción, exigir un motivo.

Conservar la versión de la política que regía cuando se confirmó el pedido. Cambiar la política posteriormente no debe alterar las condiciones históricas.

## 19.2. Reembolsos

El emprendedor debe confirmar importe, motivo y método.

Crear un movimiento nuevo relacionado con el pago original.

No borrar ni modificar el pago recibido originalmente.

## 19.3. Reconciliación

Después de cancelar o reducir un pedido, mostrar por separado:

- Importe original.
- Importe actualizado.
- Pagos recibidos.
- Costos ya incurridos.
- Importe reembolsado.
- Importe retenido, con motivo.
- Crédito generado.
- Saldo final.

Las decisiones que afecten dinero o inventario deben confirmarse expresamente.

---

# 20. Panel principal e informes

## 20.1. Dashboard

La pantalla principal debe equilibrar operaciones, inventario y finanzas.

Incluir:

**Operaciones**
- Pedidos pendientes.
- Próximas entregas.
- Producciones pendientes.

**Inventario**
- Ingredientes con stock bajo.
- Faltantes para producciones planificadas.
- Alertas activas.

**Finanzas**
- Ventas del período.
- Pagos recibidos.
- Saldos por cobrar.
- Beneficio estimado.

**Actividad reciente**
- Últimas compras.
- Producciones.
- Pedidos y entregas.
- Ventas y pagos.

Distinguir visualmente ingresos por ventas, efectivo recibido, costos históricos y valoraciones posteriores.

## 20.2. Informes

Permitir filtrar según corresponda por:

- Período.
- Producto o receta.
- Cliente.
- Estado.
- Tipo de movimiento.

Los informes deben basarse en los registros de origen y no crear datos financieros duplicados.

Mostrar las limitaciones de los datos incompletos.

## 20.3. Exportaciones

Permitir exportar a:

- Excel (.xlsx).
- CSV.

No implementar PDF en esta versión.

La exportación puede incluir toda la cuenta o módulos seleccionados.

Los informes deben respetar los filtros activos.

Las exportaciones deben:

- Incluir solo datos autorizados de la cuenta.
- Conservar identificadores y relaciones útiles.
- No modificar los datos originales.
- Evitar duplicaciones.
- Mantener una representación clara de los estados, importes y fechas.

Las exportaciones no deben convertirse en la fuente principal de almacenamiento de la aplicación.

---

# 21. Configuración de la aplicación

Crear un módulo de configuración con explicaciones claras de cada opción.

Agrupar los ajustes en:

- Datos del negocio.
- Inventario.
- Recetas y producción.
- Costos y precios.
- Ventas y pagos.
- Pedidos y entregas.
- Notificaciones.
- Informes.
- Cuenta y seguridad.

Cada opción debe indicar:

- Para qué sirve.
- Valor actual.
- Qué comportamiento modifica.
- Qué módulos afecta.
- Qué datos o procesos pueden verse afectados.

## 21.1. Cambios controlados

Utilizar un proceso guiado para los cambios delicados.

Antes de aplicar un cambio, detectar dependencias y explicar consecuencias.

Cuando sea posible, mostrar una vista previa.

Solicitar confirmación para cambios sensibles.

Conservar historial de los valores anteriores y nuevos.

Permitir revertir una configuración cuando sea seguro, sin deshacer automáticamente transacciones confirmadas.

Si revertir el ajuste no restaura la situación anterior por completo, explicar la limitación y ofrecer una alternativa segura.

Ejemplo: activar seguimiento de productos terminados requiere registrar y confirmar el saldo inicial. Desactivarlo conserva el historial, pero deja de mantener un saldo operacional.

---

# 22. Ayuda y orientación

Crear un módulo de ayuda de uso sencillo.

Incluir guías paso a paso para:

- Registrar compras.
- Administrar inventario.
- Crear recetas.
- Calcular costos.
- Simular producciones.
- Confirmar producción real.
- Administrar productos terminados.
- Gestionar pedidos y entregas.
- Registrar ventas.
- Administrar pagos y saldos.
- Resolver cancelaciones y devoluciones.
- Consultar informes y exportaciones.

Explicar conceptos como:

- Costo histórico.
- Costo de reposición.
- Margen y markup.
- Merma.
- Reservas.
- Saldo pendiente.
- Beneficio estimado.
- Valoración corregida.

Permitir buscar por tema y acceder a ayuda contextual dentro de los módulos.

Incluir errores frecuentes y sus soluciones.

La guía inicial debe poder retomarse y no debe bloquear el uso de las funciones ya disponibles.

Antes de una operación importante, mostrar una explicación breve de sus consecuencias.

---

# 23. Onboarding y datos de ejemplo

Ofrecer una configuración inicial guiada.

Permitir cargar datos de ejemplo de manera opcional.

Los datos de ejemplo deben estar claramente separados de los registros reales.

No deben crear compras, stock, producciones, pedidos o ventas que puedan confundirse con actividad real.

El usuario debe poder conservarlos o eliminarlos.

El proceso de configuración debe poder retomarse más adelante.

---

# 24. Proveedores e integraciones externas

No construir un módulo completo de proveedores en la primera versión.

El emprendedor gestionará externamente sus proveedores.

Las compras deben contener los datos necesarios para controlar cantidades, presentaciones, precios, fechas y cargos adicionales.

Permitir una referencia libre opcional a un proveedor o documento, sin exigir una ficha comercial.

Preparar la arquitectura para incorporar posteriormente un catálogo de proveedores o integración de precios, pero no desarrollar esa funcionalidad en la primera entrega.

No integrar inicialmente:

- API de precios de supermercados.
- Pasarelas de pago.
- Plataformas externas de venta.
- Sistemas tributarios.
- Integraciones que no sean necesarias para la operación básica.

La aplicación registrará los pagos realizados, pero no procesará cobros electrónicos en esta fase.

---

# 25. Sincronización y funcionamiento sin conexión

La aplicación será una PWA responsive.

Debe permitir guardar borradores localmente y consultar información previamente disponible cuando las condiciones técnicas lo permitan.

No se debe prometer que toda la aplicación funciona sin Internet.

Las operaciones reales requieren conexión y validación del servidor:

- Compras.
- Producción.
- Movimientos de inventario.
- Ventas.
- Pagos.
- Pedidos.
- Entregas.
- Devoluciones.

Mostrar el estado de conexión y la última sincronización cuando corresponda.

Al recuperar la conexión, permitir retomar los borradores y comprobar si los datos siguen vigentes.

No sincronizar automáticamente un borrador convirtiéndolo en una operación real sin confirmación.

Antes de confirmar, volver a validar stock, saldos y demás restricciones en el servidor.

Evitar que una reconexión genere duplicaciones.

---

# 26. Integridad transaccional y trazabilidad

Este apartado es crítico para el proyecto.

## 26.1. Operaciones atómicas

Implementar transacciones y restricciones en PostgreSQL para que las operaciones relacionadas se confirmen completas o no se confirmen.

Ejemplos:

- Confirmar producción y descontar ingredientes.
- Confirmar compra y aumentar inventario.
- Confirmar entrega y registrar la venta correspondiente.
- Registrar devolución y sus movimientos asociados.
- Aplicar un crédito y actualizar su saldo.
- Confirmar pagos y actualizar el saldo del pedido.

Si una parte crítica falla, no dejar registros parciales que aparenten una operación completa.

## 26.2. Idempotencia

Las operaciones críticas deben disponer de mecanismos para reconocer reintentos.

Un doble clic, una pérdida de conexión o una respuesta tardía no deben generar dos compras, producciones, ventas, pagos o entregas.

Diseñar claves de idempotencia y restricciones únicas cuando corresponda.

La idempotencia no sustituye la autorización ni la validación de datos.

## 26.3. Movimientos inmutables

Conservar los movimientos de inventario y dinero que ya fueron confirmados.

Las correcciones se realizan mediante movimientos relacionados, reversos y nuevas operaciones.

No permitir que un usuario altere manualmente un saldo sin dejar trazabilidad.

Cuando existan saldos derivados, documentar la fuente de verdad y cómo se reconcilian.

## 26.4. Restricciones

Implementar las validaciones apropiadas en el servidor y la base de datos para:

- Impedir cantidades negativas cuando no sean válidas.
- Impedir consumos superiores al saldo.
- Impedir aplicaciones de crédito superiores al saldo disponible.
- Impedir duplicaciones de operaciones.
- Evitar relaciones entre cuentas diferentes.
- Evitar entregas superiores a las cantidades válidas del pedido.
- Mantener coherencia entre cantidades, importes y movimientos.
- Evitar inconsistencias entre reservas, stock físico y stock disponible.

No depender exclusivamente de la interfaz para estas restricciones.

## 26.5. Auditoría

Registrar las acciones importantes, incluidas las correcciones, reversiones, restauraciones y accesos administrativos.

Los registros de auditoría no deben poder modificarse ni eliminarse desde el flujo administrativo ordinario.

Restringir el acceso a ellos.

Mantenerlos de forma indefinida como regla del sistema, sujeto a las obligaciones legales y de privacidad aplicables.

No almacenar secretos ni información sensible innecesaria en la auditoría.

---

# 27. Registro de errores y solicitudes

Incluir un formulario contextual para reportar errores o solicitar mejoras.

Permitir:

- Describir el problema.
- Seleccionar el módulo.
- Explicar los pasos para reproducirlo.
- Adjuntar una captura de pantalla opcional.
- Incluir datos técnicos mínimos para el diagnóstico, como versión de la aplicación, identificador de operación o código de error.

No solicitar contraseñas, credenciales ni información sensible de pagos.

No permitir adjuntar datos de otras cuentas.

Cada reporte tendrá un identificador y estado.

Los errores técnicos deben poder relacionarse con incidentes internos y con los registros de auditoría correspondientes.

---

# 28. Gestión de inactividad y abandono de cuentas

## 28.1. Inactividad

Después de 90 días sin actividad real de gestión del negocio, generar una alerta en el panel administrativo.

Se considera actividad real, por ejemplo:

- Crear o editar recetas.
- Registrar compras.
- Realizar movimientos de inventario.
- Simular o registrar producción.
- Gestionar pedidos, ventas o pagos.
- Actualizar costos, precios u otros datos operacionales.

Iniciar sesión o navegar por la aplicación no debe reiniciar el contador.

El administrador podrá:

- Mantener la cuenta activa.
- Marcarla como inactiva.
- Iniciar un proceso de desactivación o cierre.

No cerrar cuentas automáticamente por inactividad.

## 28.2. Aviso y recuperación de actividad

Al marcar una cuenta como inactiva, notificar al emprendedor dentro de la aplicación e invitarlo a proporcionar comentarios opcionales.

No exigir respuesta.

Si la cuenta sigue activa y vuelve a registrar actividad real, retirar automáticamente la marca de inactividad y reiniciar el contador, conservando el historial.

Si la cuenta ya fue desactivada o cerrada administrativamente, no reactivarla automáticamente por una actividad posterior.

## 28.3. Comentarios de abandono

Permitir comentarios abiertos y clasificación por categorías.

Categorías iniciales sugeridas:

- Problemas técnicos.
- Dificultad de uso.
- Funciones faltantes.
- Relación entre costo y valor.
- Cierre o cambio del negocio.
- Preferencia por otra herramienta.
- Falta de tiempo o uso reducido.
- Otros.
- Sin respuesta.

La clasificación automática, si se incorpora, debe ser una sugerencia. Un administrador debe validar la categoría antes de incluirla en estadísticas confirmadas.

Conservar el texto original cuando corresponda.

No mezclar las respuestas pendientes de validación con las categorías confirmadas.

## 28.4. Acceso a comentarios originales

Los administradores autorizados pueden consultar respuestas originales.

Cada consulta requiere un motivo predefinido; la opción Otros requiere explicación.

Registrar administrador, fecha, motivo y referencia a la respuesta.

Los informes ordinarios deben mostrar principalmente estadísticas y categorías, no texto original ni información personal innecesaria.

## 28.5. Alertas de comentarios pendientes

Generar alertas cuando:

- Existan cinco o más comentarios pendientes de validación.
- Una respuesta individual lleve más de cinco días sin validarse.

Los umbrales deben ser configurables.

Mostrar las alertas en el panel administrativo.

Cerrar automáticamente la alerta cuando desaparezca la condición. El administrador puede cerrarla manualmente al confirmar que fue atendida.

Conservar el historial y crear una nueva alerta cuando una condición vuelva a activarse después de haberse resuelto.

Todas las alertas tienen la misma prioridad inicial y se ordenan por fecha de creación, de más antigua a más reciente.

Mostrar:

- Alertas activas.
- Antigüedad de la alerta activa más antigua.
- Cantidad de respuestas pendientes.
- Evolución histórica.

## 28.6. Informes de abandono

Incluir indicadores básicos y análisis de:

- Tiempo hasta el abandono.
- Antigüedad de la cuenta.
- Comentarios recibidos.
- Motivos de abandono.
- Evolución por período.

Actualizar los informes cuando se registren nuevos cierres o comentarios.

Permitir configurar rango de fechas y granularidad diaria, semanal o mensual.

Mostrar períodos sin actividad con valor cero y distinguirlos de datos faltantes.

Exportar a Excel y CSV, con totales agregados y detalles de alertas según filtros.

No incluir por defecto texto original de comentarios ni datos personales innecesarios.

## 28.7. Exportaciones administrativas

Solo los administradores autorizados podrán exportar estos informes.

Registrar:

- Administrador.
- Fecha y hora.
- Formato.
- Período.
- Filtros.
- Resultado.

Si una exportación falla, reintentar automáticamente y generar una alerta si el problema persiste.

Los archivos de exportación serán temporales, disponibles durante 24 horas y luego eliminados automáticamente. No mantener una colección permanente de archivos históricos.

El registro de auditoría de exportaciones se conserva.

---

# 29. Cierre voluntario de cuentas

Permitir solicitar cierre mediante un flujo guiado.

El usuario debe elegir entre:

- Desactivación temporal.
- Cierre permanente.

Explicar las consecuencias antes de confirmar.

## 29.1. Exportación previa

Antes de un cierre permanente, ofrecer exportar los datos o continuar expresamente sin exportarlos.

Los formatos serán Excel y CSV.

El usuario podrá exportar la cuenta completa o módulos seleccionados.

## 29.2. Desactivación temporal

Conservar los datos.

Permitir solicitar reactivación mediante un flujo de recuperación dentro de la aplicación o contactando soporte.

En ambos casos, verificar la identidad y registrar la acción.

## 29.3. Cierre permanente

Bloquear el acceso a la cuenta.

Eliminar los datos que ya no deban conservarse, respetando las obligaciones legales y de retención aplicables.

Los datos que deban conservarse se mantendrán en almacenamiento restringido y separado.

No conservar indefinidamente identificadores personales dentro del conjunto analítico de abandono.

## 29.4. Datos de abandono anonimizados

Crear un conjunto de datos separado para análisis, con campos permitidos como:

- Fecha de cierre.
- Antigüedad de la cuenta.
- Tiempo hasta la inactividad.
- Motivo de abandono.
- Comentarios voluntarios tratados según las reglas de privacidad.

No incluir identificadores directos.

Revisar el riesgo de identificación indirecta antes de incorporar campos.

El módulo de análisis podrá consultar el conjunto anonimizado, pero no acceder a registros restringidos que se conservan por motivos legales o de auditoría.

Los administradores autorizados podrán consultar los registros restringidos según sus permisos y con trazabilidad.

---

# 30. Respaldos y recuperación de datos

## 30.1. Política inicial

Implementar:

- Respaldos automáticos semanales.
- Retención de 30 días.
- Exportaciones manuales.
- Registro del resultado de cada respaldo.
- Alertas ante fallas.
- Verificación de integridad.
- Pruebas periódicas de restauración.

La viabilidad real de esta política debe comprobarse según el proveedor, el plan y las herramientas disponibles. No asumir que la modalidad gratuita de Supabase proporciona por sí sola todas las capacidades necesarias.

## 30.2. Verificación

Los respaldos deben comprobar:

- Integridad.
- Estructura.
- Relaciones entre datos.
- Consistencia básica de los registros.
- Posibilidad de restauración.

Realizar pruebas de restauración en un entorno aislado.

## 30.3. Frecuencia de pruebas

Programar:

- Prueba mensual de restauración completa.
- Pruebas extraordinarias después de fallas importantes.
- Pruebas después de cambios significativos en el sistema.
- Pruebas después de incidentes de integridad.

Combinar verificaciones de muestras con pruebas completas periódicas.

## 30.4. Respaldo inválido

Si un respaldo falla:

- Aislarlo para investigación.
- No permitir que se utilice para una restauración operacional.
- Intentar generar otro respaldo.
- Revisar copias válidas anteriores.
- Generar una alerta prioritaria si no existe una copia válida.

No bloquear automáticamente a todos los emprendedores por una falla de respaldo.

La contingencia solo se cierra cuando existe una copia válida y la capacidad de restauración ha sido demostrada mediante una prueba válida.

## 30.5. Procedimiento de restauración

El procedimiento debe ser asistido:

1. Seleccionar el respaldo.
2. Restaurarlo en un entorno aislado.
3. Validar integridad y relaciones.
4. Crear un respaldo adicional del estado operacional actual.
5. Identificar cambios posteriores al respaldo elegido.
6. Evaluar cuáles pueden recuperarse de forma segura.
7. Mostrar resultados y conflictos al administrador.
8. Exigir confirmación explícita antes de modificar datos operacionales.
9. Ejecutar la restauración y recuperar cambios compatibles.
10. Verificar consistencia final y registrar auditoría.

Utilizar un registro de cambios recuperables cuando sea viable para reducir la pérdida de información entre respaldos semanales.

Recuperar automáticamente solo cambios compatibles y verificables.

Los conflictos no resueltos deben permanecer pendientes.

## 30.6. Conflictos

El sistema debe proponer alternativas seguras.

El administrador podrá recuperar o descartar un cambio cuando corresponda, indicando obligatoriamente un motivo.

Si no existe una solución segura, mantener el conflicto pendiente.

Estados posibles:

- Completada.
- Parcial.
- Pendiente.

Una restauración parcial puede finalizar la intervención operacional, pero los conflictos deben continuar visibles.

Solo marcarla como completada cuando las verificaciones requeridas estén realizadas y no existan conflictos pendientes que impidan validar el resultado.

## 30.7. Pruebas después de restaurar

Ejecutar pruebas automáticas de las operaciones críticas.

Si falla una prueba crítica, no declarar válida la restauración.

Si solo existen fallas no críticas, permitir aceptación parcial documentada, indicando las limitaciones.

El administrador gestiona los problemas de datos y restauración; el equipo técnico corrige defectos de código. Ambos trabajan sobre el mismo incidente.

---

# 31. Notificaciones administrativas

Todas las alertas deben aparecer en el panel administrativo.

Asignar prioridad según impacto y riesgo, utilizando niveles como crítico, alto, medio e informativo cuando corresponda.

Enviar correos solo para alertas críticas y altas.

Para una misma incidencia, enviar un correo de notificación, sin crear correos duplicados por cada reintento.

Si el envío falla, conservar la alerta en el panel e intentar enviar el correo nuevamente.

Política de reintentos:

- Intento inicial.
- Segundo intento después de 5 minutos.
- Tercer intento después de 15 minutos.
- Cuarto intento después de 30 minutos.
- Quinto intento después de 60 minutos.
- Sexto y último intento después de 120 minutos desde el intento anterior.

Si el último intento falla, detener los reintentos automáticos y dejar la incidencia pendiente de revisión administrativa.

No enviar recordatorios diarios ni un correo por cada intento.

El éxito del correo no significa que la incidencia se haya resuelto.

---

# 32. Interfaz y experiencia de usuario

## 32.1. Estilo visual

Utilizar un diseño sobrio, profesional, limpio y funcional.

Evitar una apariencia excesivamente genérica, recargada o reconociblemente generada automáticamente.

Priorizar:

- Jerarquía visual clara.
- Tipografía legible.
- Colores discretos.
- Espaciado consistente.
- Formularios sencillos.
- Tablas legibles.
- Estados claramente identificados.
- Componentes reutilizables.
- Mensajes directos.
- Navegación predecible.

No usar animaciones decorativas innecesarias ni paneles llenos de indicadores que no aporten valor.

## 32.2. Responsive y PWA

La misma aplicación debe funcionar en ordenador y teléfono.

En escritorio, utilizar una barra lateral para los módulos.

En móvil, utilizar navegación compacta y formularios adaptados a pantallas pequeñas.

La aplicación debe poder instalarse como PWA cuando el navegador lo permita.

## 32.3. Formularios

Los formularios simples deben ser breves.

Los procesos complejos deben utilizar pasos guiados, especialmente:

- Compras.
- Producción.
- Cierre de pedidos.
- Cancelaciones.
- Devoluciones.
- Restauraciones.

## 32.4. Guardado y confirmación

Implementar guardado automático de borradores cuando sea seguro.

Las operaciones reales siempre requieren confirmación explícita.

Si el usuario intenta abandonar un formulario con cambios no guardados, ofrecer guardar, descartar o regresar.

No mostrar advertencias innecesarias cuando el borrador ya está guardado.

## 32.5. Confirmaciones

Utilizar confirmaciones proporcionales al riesgo:

- Acciones simples: aviso breve.
- Operaciones importantes: resumen contextual.
- Acciones críticas: validación reforzada y confirmación explícita.

Los errores deben explicar el problema y orientar al usuario para resolverlo.

---

# 33. Migraciones, cambios y despliegues

## 33.1. Entornos

Separar:

- Desarrollo.
- Pruebas.
- Producción.

No utilizar datos reales de usuarios en pruebas sin autorización y controles apropiados.

Las migraciones de base de datos deben estar versionadas y formar parte del repositorio.

## 33.2. Compatibilidad

Diseñar cambios de base de datos para ser compatibles con los registros existentes siempre que sea posible.

No desplegar una migración que borre o altere silenciosamente operaciones confirmadas.

Separar el rollback del código del rollback de datos. Volver a una versión anterior de la aplicación no debe provocar pérdida de compras, pagos, producciones o entregas.

## 33.3. Publicación

Antes de cada versión:

1. Ejecutar compilación.
2. Ejecutar pruebas unitarias.
3. Ejecutar pruebas de integración.
4. Ejecutar pruebas de seguridad.
5. Ejecutar regresiones.
6. Verificar migraciones.
7. Ejecutar pruebas de los flujos principales.
8. Revisar errores críticos.
9. Confirmar que existe una estrategia de recuperación.

Cuando sea posible, realizar despliegues graduales y observar el comportamiento posterior.

Los fallos críticos de seguridad, dinero o inventario bloquean la publicación.

---

# 34. Pruebas y criterios de aceptación

No considerar terminado un módulo solo porque su pantalla se vea correcta.

Las pruebas deben cubrir funciones, reglas de negocio, integridad, seguridad y recorridos completos.

## 34.1. Pruebas unitarias

Probar:

- Cálculos de recetas.
- Costos por envase.
- Costo teórico y real.
- Markup y margen.
- Descuentos.
- Distribución de costos adicionales.
- Créditos.
- Saldos.
- Reglas de reservas.
- Reglas de cancelación.
- Cálculo de ventas y resultados.

## 34.2. Pruebas de integración

Comprobar interacciones entre:

- Compras e inventario.
- Recetas y costos.
- Producción e inventario.
- Productos terminados y pedidos.
- Entregas y ventas.
- Ventas y pagos.
- Devoluciones y créditos.
- Movimientos y reportes.
- Exportaciones y filtros.

## 34.3. Pruebas de extremo a extremo

Debe poder ejecutarse un recorrido como este:

1. Crear una cuenta de prueba.
2. Confirmar el correo.
3. Configurar el negocio.
4. Registrar ingredientes y presentaciones.
5. Registrar compras.
6. Comprobar inventario.
7. Crear una receta.
8. Simular una producción.
9. Revisar costos y faltantes.
10. Confirmar producción real.
11. Verificar consumo por envase.
12. Registrar productos terminados, si el seguimiento está habilitado.
13. Crear un pedido.
14. Preparar y reservar productos.
15. Registrar una entrega.
16. Comprobar la venta generada.
17. Registrar pagos parciales o totales.
18. Revisar saldos e informes.
19. Exportar datos.
20. Comprobar que el historial mantiene las relaciones originales.

## 34.4. Pruebas de excepciones

Probar además:

- Inventario insuficiente.
- Dos producciones concurrentes.
- Dos ventas que intentan utilizar las mismas unidades.
- Reintentos después de una desconexión.
- Doble confirmación.
- Cancelación después de producir.
- Cancelación después de una entrega parcial.
- Reembolsos.
- Créditos parciales y vencidos.
- Cambios de precios.
- Costos incompletos.
- Devoluciones.
- Restauración de respaldos.
- Exportaciones fallidas.
- Errores de correo.
- Acceso entre cuentas.
- Sesiones vencidas.
- Cambios de configuración que afectan otros módulos.

## 34.5. Criterios de aceptación

Antes de considerar lista una versión:

- Los datos se persisten realmente.
- La autenticación funciona.
- Las cuentas están aisladas.
- Los movimientos se registran correctamente.
- Las operaciones críticas son atómicas.
- No existen deducciones duplicadas.
- No existen saldos negativos por operaciones inválidas.
- Los costos y pagos se reconcilian.
- Las exportaciones respetan filtros y permisos.
- Las pruebas críticas pasan.
- Los errores conocidos están documentados.
- Existe una estrategia verificable de respaldo y recuperación.

Los fallos críticos de seguridad, dinero e inventario impiden considerar lista la versión.

Los elementos no críticos pendientes deben documentarse con su impacto y riesgo.

---

# 35. Despliegue inicial en ordenador propio

La primera fase puede ejecutarse localmente.

El proyecto debe proporcionar instrucciones para:

- Instalar dependencias.
- Configurar variables de entorno.
- Crear o conectar el proyecto de Supabase.
- Ejecutar migraciones.
- Cargar datos de prueba.
- Iniciar el frontend.
- Ejecutar pruebas.
- Compilar la aplicación.
- Resolver errores habituales.

Debe existir un archivo de configuración de ejemplo sin secretos reales.

La aplicación puede abrirse inicialmente mediante `localhost`.

Para pruebas desde otros dispositivos de la misma red, documentar cómo exponer el frontend de desarrollo a la red local sin abrir innecesariamente servicios internos ni credenciales.

No exigir dominio público para esta etapa.

No exponer PostgreSQL ni interfaces administrativas directamente a Internet.

No asumir que una dirección local será accesible desde fuera de la red.

La posibilidad de acceder desde Internet se evaluará después de validar la primera fase.

---

# 36. Control de costos de infraestructura

Priorizar servicios gratuitos o de bajo costo, siempre que sean suficientes.

Antes de decidir un proveedor o plan, verificar:

- Límites de base de datos.
- Almacenamiento.
- Tráfico.
- Límites de autenticación.
- Envío de correo.
- Respaldos.
- Restauración.
- Logs.
- Exportaciones.
- Almacenamiento de archivos.
- Límites de funciones de servidor.
- Disponibilidad y restricciones de los planes gratuitos.

No asumir que el plan gratuito cubre automáticamente la retención de respaldos requerida, la verificación de dispositivos o el envío de correos.

Mantener separadas las configuraciones de proveedor para que sea posible cambiar de plan o servicio sin rehacer toda la aplicación.

La decisión de contratar infraestructura adicional queda pendiente de la validación funcional de la primera fase.

---

# 37. Módulos que quedan fuera de la primera versión

No desarrollar en la primera entrega:

- Aplicación nativa independiente para Android o iOS.
- Múltiples empleados por negocio.
- Permisos internos por empleado.
- Integración automática con supermercados.
- Catálogo completo de proveedores.
- Pasarelas de pago.
- Sincronización con sistemas tributarios.
- Sustitución automática de ingredientes.
- Control obligatorio de lotes y fechas de vencimiento.
- Contabilidad formal.
- Importación masiva desde Excel o CSV.
- Exportación PDF.
- Automatización de decisiones comerciales o legales.
- Integraciones externas que no sean esenciales.

La arquitectura debe permitir ampliar el sistema posteriormente, pero no sacrificar la calidad de las funciones principales para desarrollar estas extensiones prematuramente.

---

# 38. Orden de trabajo para el agente de IA

No intentes construir todo mediante una única generación de código sin comprobar resultados.

Trabaja por etapas, manteniendo como objetivo final el sistema completo.

## Etapa 1. Inspección y planificación

Antes de modificar archivos:

1. Inspecciona el ordenador y el repositorio disponible.
2. Comprueba las herramientas instaladas.
3. Revisa la estructura existente, si la hay.
4. Identifica dependencias y limitaciones.
5. Presenta la arquitectura propuesta.
6. Define módulos, entidades y relaciones.
7. Identifica los riesgos técnicos principales.
8. Prepara un plan de implementación.
9. No sobrescribas archivos existentes sin revisar su función.

Si el proyecto no existe, inicialízalo con una estructura clara.

## Etapa 2. Fundamentos

Implementa:

- Estructura del proyecto.
- Configuración de entornos.
- Conexión a Supabase.
- Migraciones.
- Autenticación.
- Aislamiento por cuenta.
- Auditoría.
- Componentes visuales básicos.
- Pruebas iniciales.

Valida la seguridad antes de construir todos los módulos sobre una base insegura.

## Etapa 3. Núcleo operacional

Construye y prueba:

- Ingredientes y presentaciones.
- Compras.
- Movimientos de inventario.
- Recetas y versiones.
- Simulaciones.
- Producción real.
- Costos.
- Productos terminados.

Prioriza la consistencia de los movimientos y cálculos.

## Etapa 4. Gestión comercial

Construye y prueba:

- Clientes.
- Pedidos.
- Reservas.
- Entregas parciales.
- Ventas directas.
- Pagos.
- Saldos.
- Créditos.
- Cancelaciones.
- Devoluciones y reclamos.

Verifica que las operaciones comerciales estén integradas con producción e inventario.

## Etapa 5. Informes y configuración

Implementa:

- Dashboard.
- Informes.
- Exportaciones.
- Gastos generales.
- Configuración del negocio.
- Ayuda.
- Onboarding.
- Datos de ejemplo.

## Etapa 6. Administración y recuperación

Implementa:

- Panel administrativo.
- Auditoría de accesos.
- Gestión de incidencias.
- Inactividad y abandono.
- Comentarios.
- Alertas.
- Exportaciones administrativas.
- Respaldos y restauración.

Las funciones de seguridad, aislamiento, trazabilidad y recuperación necesarias para operar correctamente no pueden posponerse hasta después del lanzamiento.

## Etapa 7. Integración y validación

Ejecuta los recorridos completos, pruebas de concurrencia, pruebas de seguridad, recuperación y exportación.

Resuelve los fallos críticos antes de avanzar a una versión considerada funcional.

## Etapa 8. Entrega

Prepara:

- Código fuente organizado.
- Migraciones de base de datos.
- Archivo de variables de entorno de ejemplo.
- Instrucciones de instalación.
- Instrucciones de ejecución local.
- Instrucciones de configuración de Supabase.
- Configuración de correo.
- Pruebas automatizadas.
- Documentación de arquitectura.
- Documentación de decisiones importantes.
- Lista de limitaciones verificadas.
- Lista de tareas pendientes.
- Procedimiento de respaldo y recuperación.

No declarar una funcionalidad terminada si solo existe la interfaz o si depende de datos simulados.

---

# 39. Forma de trabajo esperada del agente

Durante el desarrollo:

1. Explica brevemente qué vas a construir y por qué.
2. Inspecciona antes de modificar.
3. Realiza cambios concretos en los archivos del proyecto.
4. Ejecuta las pruebas correspondientes.
5. Comprueba errores de compilación y ejecución.
6. Verifica que las reglas de negocio se respeten.
7. Informa qué quedó terminado y qué falta.
8. Mantén documentación actualizada.
9. Evita duplicar código y reglas de negocio.
10. No afirmes haber probado una función que no hayas ejecutado.

No te limites a describir el código: cuando dispongas de las herramientas necesarias, crea los archivos, implementa las funciones, ejecuta los comandos y verifica los resultados.

Si una operación requiere credenciales, autorización externa o una decisión del usuario, prepara todo lo que sea posible sin inventar credenciales ni fingir que la integración está activa.

Si una capacidad depende del plan de un proveedor, verifica sus condiciones y documenta la limitación. No diseñes silenciosamente una función que después no pueda operar en el entorno previsto.

Si encuentras un problema que compromete la seguridad, la integridad de los datos o una regla de negocio, resuélvelo antes de considerar terminada la función afectada.

---

# 40. Resultado esperado

El resultado final debe ser una plataforma web integral para la gestión de emprendimientos gastronómicos, con una interfaz sobria y adaptable a ordenadores y teléfonos, persistencia real, autenticación segura, aislamiento estricto entre cuentas, módulos interconectados y trazabilidad completa.

El sistema debe poder seguir un recorrido real desde la compra de ingredientes hasta la producción, la gestión de productos terminados, los pedidos, las entregas, las ventas, los pagos y los informes.

Debe ser capaz de explicar de dónde provienen los saldos y costos, preservar el historial de operaciones, manejar correcciones sin borrar el pasado y evitar inconsistencias cuando ocurran errores, desconexiones o acciones simultáneas.

La primera fase debe ser suficientemente completa para comprobar el funcionamiento integral del negocio. No se busca una calculadora aislada ni una demostración visual, sino una base sólida para un producto que pueda crecer.

**Prioridad final:** integridad de datos, seguridad, trazabilidad, coherencia entre módulos y funcionamiento verificable. La apariencia visual es importante, pero nunca debe prevalecer sobre la corrección de las operaciones.

Comienza inspeccionando el entorno disponible y presenta el plan técnico inicial. Después inicia la implementación y valida cada etapa antes de continuar.
