/**
 * Minimal typings for the `tweetnacl-sealedbox-js` dependency (the package ships
 * without TypeScript declarations). It is a regular dependency, imported
 * dynamically so it only loads when payload encryption is enabled.
 */
declare module 'tweetnacl-sealedbox-js' {
    export function seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
    export function open(
        box: Uint8Array,
        publicKey: Uint8Array,
        secretKey: Uint8Array,
    ): Uint8Array | null;

    const sealedbox: { seal: typeof seal; open: typeof open };
    export default sealedbox;
}
