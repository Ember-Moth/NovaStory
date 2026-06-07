import { Route, Switch } from "wouter";

import { HomePage } from "./components/HomePage";
import { ProjectLayout } from "./components/ProjectLayout";
import "./index.css";

export function App() {
  return (
    <Switch>
      <Route path="/">
        <HomePage />
      </Route>
      <Route path="/project/:id">{({ id }) => <ProjectLayout id={id} />}</Route>
      <Route path="/projects/:id">{({ id }) => <ProjectLayout id={id} />}</Route>
      <Route>404: No such page!</Route>
    </Switch>
  );
}
