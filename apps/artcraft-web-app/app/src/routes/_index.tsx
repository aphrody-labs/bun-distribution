import type { HeadersFunction } from "@remix-run/node";
import { withProtectionRoute } from "~/hoc/withProtectedRoute";
import { MainApp } from "~/pages/MainApp";

export const headers: HeadersFunction = () => ({});

const Index = withProtectionRoute(() => <MainApp />);

export default Index;
