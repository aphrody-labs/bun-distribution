// Augmente @aphrody/discordx avec les types/méthodes utilisés par le bot mais
// non exportés par le fork (MethodDecoratorEx, ClassDecoratorEx, etc.).

import "@aphrody/discordx";

declare module "@aphrody/discordx" {
	export type MethodDecoratorEx = (
		target: any,
		propertyKey: any,
		descriptor?: PropertyDescriptor
	) => any;

	export type ClassDecoratorEx = (target: any) => any;

	export type ClassMethodDecorator = (
		target: any,
		propertyKey?: any,
		descriptor?: PropertyDescriptor
	) => any;

	export interface DOn {
		decorate(...args: any[]): any;
	}
}
