import incrSsArkJson from "./incr-ss-ark.json";
import ypsilon14Json from "./ypsilon14.json";
import sampleJson from "./sample.json";

export interface BundledScript {
    id: string;
    label: string;
    json: any;
}

export const BUNDLED_SCRIPTS: BundledScript[] = [
    { id: "incr-ss-ark", label: "INCR-SS-ARK",  json: incrSsArkJson },
    { id: "ypsilon14",   label: "YPSILON-14",    json: ypsilon14Json },
    { id: "sample",      label: "SAMPLE",         json: sampleJson    },
];

export const DEFAULT_SCRIPT = BUNDLED_SCRIPTS[0];
