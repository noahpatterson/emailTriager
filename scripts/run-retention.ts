import { config } from "dotenv";
config({ path: ".env.local" });

const { RetentionService } = await import("../src/server/retention");
const result = await new RetentionService().run();
console.log(JSON.stringify(result));
