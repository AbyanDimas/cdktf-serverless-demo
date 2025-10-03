import { App } from "cdktf";
import { MainStack } from "./src/stacks/main-stack";

const app = new App();
new MainStack(app, "serverless");
app.synth();