set -e

# Runs on every push to main. When the merged PR has a size label, publishes
# the package to npm and opens a "Bump version" PR, because main only accepts
# changes through pull requests.

install_gh() {
  type -p curl >/dev/null || sudo apt install curl -y
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
  sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  sudo apt update
  sudo apt install gh -y
}

bump_package() {
  echo "== Bump the NPM package version =="
  yarn install --frozen-lockfile
  yarn build
  yarn config set version-tag-prefix "v"
  yarn version --"$VERSION_LABEL" --no-git-tag-version
  echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN:?is not set. Add it as a NeetoCI variable}" >~/.npmrc
  yarn publish --non-interactive --access public
}

raise_pr() {
  git config user.name "neetobot"
  git config user.email "unnikrishnan.kp+neetobot@bigbinary.com"
  git config core.hooksPath /dev/null
  git push origin --delete bump-version || true
  git checkout -b bump-version
  git add package.json
  git commit -m "Bump version"
  git push --set-upstream origin bump-version
  gh pr create -B main -H bump-version -t "Bump version" -b "This is an automated PR." -l instant-mergepr -a @me
}

install_gh

LATEST_COMMIT_SHA=$(git log -1 --pretty=format:"%H")
echo "Latest commit SHA: $LATEST_COMMIT_SHA"

PR_NUMBER=$(gh pr list --state merged --search "$LATEST_COMMIT_SHA" --json number --jq ".[0].number")
echo "Last merged PR number: $PR_NUMBER"

[[ -z "$PR_NUMBER" ]] && exit 0

PR_LABELS=$(gh pr view "$PR_NUMBER" --json labels --jq ".labels[].name" | tr "\n" " ")
echo "PR labels: $PR_LABELS"

VERSION_LABEL=""
for version_label in major minor patch; do
  if echo " $PR_LABELS " | grep -q " $version_label "; then
    VERSION_LABEL="$version_label"
    break
  fi
done
echo "Version label selected: ${VERSION_LABEL:-none}"

[[ -z "$VERSION_LABEL" ]] && exit 0

bump_package
raise_pr
