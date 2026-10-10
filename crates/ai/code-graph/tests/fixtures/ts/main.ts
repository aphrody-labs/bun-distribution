import { square } from "./math";

export function area(side: number): number {
    return square(side);
}

export class Box {
    constructor(public side: number) {}
    area(): number { return this.side * 2; }
}

export interface Shape { area(): number; }
export type Length = number;
