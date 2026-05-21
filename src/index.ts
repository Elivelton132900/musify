import app from "./app"; // Importe o app configurado
import dotenv from "dotenv";

dotenv.config();

const PORT = 3000;

app.listen(PORT, () => {
    console.log(`Server rodando em http://localhost:${PORT}`);
});