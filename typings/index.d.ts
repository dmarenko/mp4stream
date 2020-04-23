/// <reference types="node" />
declare type BoxCallback = (box: Buffer) => void;
export default class MP4Stream {
    private ftyp;
    private moov;
    private pair;
    private readonly typeChecker;
    private bytesNeeded;
    private bytesReceived;
    private accum;
    private currentBoxType;
    private viewers;
    feed(mp4stream: Buffer): void;
    addViewer(callback: BoxCallback): void;
    removeViewer(callback: BoxCallback): boolean;
}
export {};
