Once the repo is downloaded, the app can be built locally using either npm run dev (root directory) or npm run build (dist directory).

After it can be loaded in Chrome through Settings/Extensions, enabling Developer Mode, and loading the  Unpacked Extension by pointing at the directory where the build was performed. 

The application contains a mechanism for the graceful download of additional packages, but still experimental features must be approved for usage by the user using the chrome://flags URL.

If the tester does want for any reason to package the application, the pem key has been provided in the repo.
