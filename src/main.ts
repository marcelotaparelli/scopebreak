import "./style.css";
import { Game } from "./game/Game";

const app = document.getElementById("app");
if (!app) throw new Error("#app missing");
new Game(app);
