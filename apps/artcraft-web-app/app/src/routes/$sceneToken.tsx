import type { HeadersFunction } from "@remix-run/node";
import { useParams } from "react-router-dom";

import { withProtectionRoute } from "~/hoc/withProtectedRoute";
import { MainApp } from "~/pages/MainApp";
// import { Page404 } from "~/pages/Page404";

export const headers: HeadersFunction = () => ({});

const Index = withProtectionRoute(() => {
  const params = useParams();
  return <MainApp sceneToken={params.sceneToken} />;

  //NOTE: wil: CODE SAMPLE FOR ROUTING 404
  //           PLEAE DO NOT DELETE THE BELOW
  // if (params.sceneToken && params.sceneToken.slice(0,2) === "m_" && params.sceneToken.length === 32){
  //   return ( <PageScene sceneToken={params.sceneToken} />);
  // }else{
  //   return (<Page404 />);
  // }
});
export default Index;
