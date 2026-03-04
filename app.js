// Compatibility shim: keeps legacy <script src="app.js"> deployments working.
(function bootstrapWareraApp() {
  const script = document.createElement("script");
  script.type = "module";
  script.src = "./src/main.js";
  document.head.appendChild(script);
}());
