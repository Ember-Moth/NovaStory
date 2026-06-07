import { Route, Switch } from "wouter";

import { HomePage } from "@/features/home/HomePage";
import { ProjectPage } from "@/features/project";

import "./styles.css";

export function App() {
  return (
    <Switch>
      <Route path="/">
        <HomePage />
      </Route>
      <Route path="/project/:id">{({ id }) => <ProjectPage id={id} />}</Route>
      <Route path="/projects/:id">{({ id }) => <ProjectPage id={id} />}</Route>
      <Route>404: No such page!</Route>
    </Switch>
  );
}
