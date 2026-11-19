import incrSsArkJson from "./incr-ss-ark.json";
import gradientDescentTerminalJson from "./gradient-descent-terminal.json";
import ypsilon14Json from "./ypsilon14.json";
import sampleJson from "./sample.json";
import aphelionMainframeJson from "./aphelion-mainframe.json";
import ypsilon14FileSystemJson from "./ypsilon14-filesystem.json";

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
    { id: "ypsilon14-filesystem", label: "YPSILON-14 FILE SYSTEM", json: ypsilon14FileSystemJson },
    { id: "sample",      label: "PHOSPHOR SAMPLE MODULE",     json: sampleJson    },
];

export const DEFAULT_SCRIPT = BUNDLED_SCRIPTS[0];
