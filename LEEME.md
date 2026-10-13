# Sleeping Fox en Netlify

Esta carpeta es la página completa con su base de datos (Netlify Blobs).
Lo que publicás desde el panel admin (productos, fotos, textos, tarifas) lo ven todos los visitantes.
También quedan guardados los pedidos, las cuentas de clientes y el chat.

## Importante
No la subas arrastrando la carpeta a "Netlify Drop": así se publica solo la página, sin la base de datos.
Usá una de estas dos formas.

### Opción A: con GitHub (sin usar la consola)
1. Creá un repositorio en GitHub y subí todo el contenido de esta carpeta.
2. En Netlify: **Add new site → Import an existing project → GitHub** y elegí el repositorio.
3. Dejá la configuración como viene (la toma de `netlify.toml`) y tocá **Deploy**.

### Opción B: con la consola
1. Instalá Node.js (versión 18 o más nueva).
2. En esta carpeta ejecutá:
   ```
   npm install
   npx netlify-cli login
   npx netlify-cli deploy --prod
   ```

## Usuario del panel admin
Viene listo con **Usuario: Mari** y **Contraseña: Gael123**.
Para cambiarlos: Netlify → tu sitio → **Site configuration → Environment variables** y cargá:
- `ADMIN_USER` y `ADMIN_PASSWORD` con los valores nuevos.
- `SESSION_SECRET` con cualquier texto largo y secreto (protege las sesiones de los clientes).

Después de cambiar variables, volvé a desplegar el sitio (Deploys → Trigger deploy).

## Entrar con Google (opcional)
1. En Google Cloud Console → **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth** (tipo "Aplicación web").
2. En "Orígenes de JavaScript autorizados" poné la dirección de tu sitio (ej.: `https://sleepingfox.netlify.app`).
3. Copiá el "ID de cliente" y cargalo en Netlify como variable `GOOGLE_CLIENT_ID`. Volvé a desplegar.
Sin esa variable, los clientes igual pueden crear su cuenta con email y contraseña.

## Primer uso
1. Abrí tu sitio, menú (tres barritas) → **Admin** → entrá con Mari.
2. Tocá **Publicar cambios** una vez: así se copia el catálogo a la base de datos.
3. En **Página → Tarifas de envío al exterior** cargá los precios de Correo Argentino y Andreani para que los clientes vean el cálculo.
4. En **Pedidos** vas a ver cada pedido con su detalle, el total, el estado y el chat con el cliente.
