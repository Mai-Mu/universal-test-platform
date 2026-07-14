import { startApp } from "./js/app.js";

startApp().catch(error => {
  console.error("Failed to start application:", error);
});
