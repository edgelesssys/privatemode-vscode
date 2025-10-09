# Publishing on the marketplace

Marketplace publisher ID: edgeless-systems:
Marketplace publisher page: https://marketplace.visualstudio.com/manage/publishers/edgeless-systems

## Automated publishing
The extension is published via a [GitHub Workflow](.github/workflows/release.yml)

To start the publishing process
1. create a new branch named release/*,
2. push it to the repo,

## Manual publishing
To publish an extension, login and run `vsce publish` as described [here](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

```sh
vsce login edgeless-systems
vsce publish
```

To login, you need a personal access token.

Folow the description to unpublish an extension.
