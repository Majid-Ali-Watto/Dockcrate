/** What to expect from the generated files, said plainly: a starting point that usually needs a few small edits. */
export default function Accuracy() {
  return (
    <aside className="accuracy" aria-label="About the accuracy of the generated files">
      <p>
        <strong>Treat these files as a very good first draft.</strong> Small changes after you download them are normal: a port, a start command, a secret
        name, a resource limit.
      </p>
      <details>
        <summary>How accurate is it?</summary>
        <ul>
          <li>
            <strong>Dockerfile, .dockerignore, compose: high for standard projects.</strong> The stack, runtime version, port and commands are assumed from
            what you pick (the notes say which assumptions were made). Custom build steps, private registries or packages, native libraries and unusual
            folder layouts need your input.
          </li>
          <li>
            <strong>CI pipelines: good, not run for you.</strong> The syntax is checked and the structure follows each provider&rsquo;s conventions, but
            nothing here has run on your CI: secrets, runner labels, branch rules and test commands often need a tweak.
          </li>
          <li>
            <strong>Deployment files: a template.</strong> Kubernetes, ECS, Cloud Run, Azure, Fly and SSH deploys are generated from templates and were not
            run against a real account or server, so expect to adjust names, regions, resources and permissions.
          </li>
          <li>
            <strong>Before you rely on it:</strong> read the notes below (they list everything that was guessed or left out), build the image once, and run
            the pipeline on a branch. You can edit any block here first (<em>Edit blocks</em>) and your edits are kept when you change the options, or edit
            the files after downloading.
          </li>
        </ul>
      </details>
    </aside>
  );
}
