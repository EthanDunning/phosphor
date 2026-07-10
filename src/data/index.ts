import incrSsArkJson from "./incr-ss-ark.json";
import gradientDescentTerminalJson from "./gradient-descent-terminal.json";
import ypsilon14Json from "./ypsilon14.json";
import sampleJson from "./sample.json";
import aphelionMainframeJson from "./aphelion-mainframe.json";
import alienTerminalJson from "./alien-terminal.json";

export interface BundledScript {
    id: string;
    label: string;
    json: any;
}

export const BUNDLED_SCRIPTS: BundledScript[] = [
    { id: "ypsilon14",   label: "YPSILON-14",    json: ypsilon14Json },
    // { id: "aphelion-mainframe", label: "APHELION_MAINFRAME", json: aphelionMainframeJson },
    // { id: "incr-ss-ark", label: "INCR-SS-ARK",  json: incrSsArkJson },
    // { id: "gradient-descent-terminal", label: "GRADIENT DESCENT TERMINAL", json: gradientDescentTerminalJson },
    { id: "alien-terminal", label: "ALIEN TERMINAL (SEEGSON)", json: alienTerminalJson },
    { id: "sample",      label: "PHOSPHOR SAMPLE SCRIPT",     json: sampleJson    },
];

export const DEFAULT_SCRIPT = BUNDLED_SCRIPTS[0];
