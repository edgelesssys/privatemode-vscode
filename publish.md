# Publishing on the marketplace

Marketplace publisher ID: edgeless-systems
Marketplace publisher page: https://marketplace.visualstudio.com/manage/publishers/edgeless-systems

> Note: The marketplace accepts only `major.minor.patch` versions. To publish a pre-release before an actual release follow the [guidelines](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions).

## Publish workflow
The extension is published via a [GitHub Workflow](.github/workflows/release.yml):
1. create a new branch named `release/VERSION`, where `VERSION` is the version from [package.json](package.json)
2. push it to the repo

## Manual publishing and unpublishing
To publish an extension, login and run `vsce publish` as described [here](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

```sh
vsce login edgeless-systems
vsce publish
```

To login, you need a [personal access token](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token).

Folow the description in the docs to unpublish an extension.
