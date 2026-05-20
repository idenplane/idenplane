import { Command } from 'commander';
import chalk from 'chalk';

const BASH_COMPLETION = `
# authme bash completion
_authme_completion() {
  local cur prev words cword
  _init_completion || return

  local commands="login logout whoami init realm user client role group config completion upgrade migrate"
  local realm_cmds="list create get update delete export import"
  local user_cmds="list create get update delete set-password bulk-import"
  local client_cmds="list create get update delete rotate-secret"
  local role_cmds="list create get update delete assign unassign"
  local group_cmds="list create get update delete"
  local config_cmds="show validate"
  local completion_cmds="bash zsh fish"

  case "\${words[1]}" in
    realm)
      COMPREPLY=( $(compgen -W "\${realm_cmds}" -- "\${cur}") )
      return ;;
    user)
      COMPREPLY=( $(compgen -W "\${user_cmds}" -- "\${cur}") )
      return ;;
    client)
      COMPREPLY=( $(compgen -W "\${client_cmds}" -- "\${cur}") )
      return ;;
    role)
      COMPREPLY=( $(compgen -W "\${role_cmds}" -- "\${cur}") )
      return ;;
    group)
      COMPREPLY=( $(compgen -W "\${group_cmds}" -- "\${cur}") )
      return ;;
    config)
      COMPREPLY=( $(compgen -W "\${config_cmds}" -- "\${cur}") )
      return ;;
    completion)
      COMPREPLY=( $(compgen -W "\${completion_cmds}" -- "\${cur}") )
      return ;;
    *)
      COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
      return ;;
  esac
}

complete -F _authme_completion authme
`;

const ZSH_COMPLETION = `
#compdef authme

_authme() {
  local state line
  typeset -A opt_args

  _arguments \\
    '1: :->command' \\
    '*: :->args'

  case \$state in
    command)
      local commands
      commands=(
        'login:Authenticate with an AuthMe server'
        'logout:Clear saved credentials'
        'whoami:Show current authenticated user info'
        'init:Interactive setup wizard'
        'realm:Manage realms'
        'user:Manage users'
        'client:Manage clients'
        'role:Manage roles'
        'group:Manage groups'
        'config:Manage CLI configuration'
        'completion:Output shell completion script'
        'upgrade:Upgrade the AuthMe server to a new version'
        'migrate:Migrate users and configuration from another IdP'
      )
      _describe 'command' commands
      ;;
    args)
      case \$line[1] in
        realm)
          local sub=(list create get update delete export import)
          _describe 'subcommand' sub ;;
        user)
          local sub=(list create get update delete set-password bulk-import)
          _describe 'subcommand' sub ;;
        client)
          local sub=(list create get update delete rotate-secret)
          _describe 'subcommand' sub ;;
        role)
          local sub=(list create get update delete assign unassign)
          _describe 'subcommand' sub ;;
        group)
          local sub=(list create get update delete)
          _describe 'subcommand' sub ;;
        config)
          local sub=(show validate)
          _describe 'subcommand' sub ;;
        completion)
          local sub=(bash zsh fish)
          _describe 'shell' sub ;;
      esac
      ;;
  esac
}

_authme
`;

const FISH_COMPLETION = `
# authme fish completion

set -l authme_commands login logout whoami init realm user client role group config completion upgrade migrate

complete -c authme -f -n '__fish_use_subcommand' -a login       -d 'Authenticate with an AuthMe server'
complete -c authme -f -n '__fish_use_subcommand' -a logout      -d 'Clear saved credentials'
complete -c authme -f -n '__fish_use_subcommand' -a whoami      -d 'Show current authenticated user info'
complete -c authme -f -n '__fish_use_subcommand' -a init        -d 'Interactive setup wizard'
complete -c authme -f -n '__fish_use_subcommand' -a realm       -d 'Manage realms'
complete -c authme -f -n '__fish_use_subcommand' -a user        -d 'Manage users'
complete -c authme -f -n '__fish_use_subcommand' -a client      -d 'Manage clients'
complete -c authme -f -n '__fish_use_subcommand' -a role        -d 'Manage roles'
complete -c authme -f -n '__fish_use_subcommand' -a group       -d 'Manage groups'
complete -c authme -f -n '__fish_use_subcommand' -a config      -d 'Manage CLI configuration'
complete -c authme -f -n '__fish_use_subcommand' -a completion  -d 'Output shell completion script'
complete -c authme -f -n '__fish_use_subcommand' -a upgrade     -d 'Upgrade the AuthMe server to a new version'
complete -c authme -f -n '__fish_use_subcommand' -a migrate     -d 'Migrate users and configuration from another IdP'

# realm subcommands
complete -c authme -f -n '__fish_seen_subcommand_from realm' -a 'list create get update delete export import'
# user subcommands
complete -c authme -f -n '__fish_seen_subcommand_from user'  -a 'list create get update delete set-password bulk-import'
# client subcommands
complete -c authme -f -n '__fish_seen_subcommand_from client' -a 'list create get update delete rotate-secret'
# role subcommands
complete -c authme -f -n '__fish_seen_subcommand_from role'  -a 'list create get update delete assign unassign'
# group subcommands
complete -c authme -f -n '__fish_seen_subcommand_from group' -a 'list create get update delete'
# config subcommands
complete -c authme -f -n '__fish_seen_subcommand_from config' -a 'show validate'
# completion subcommands
complete -c authme -f -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'
`;

const SCRIPTS: Record<string, string> = {
  bash: BASH_COMPLETION,
  zsh: ZSH_COMPLETION,
  fish: FISH_COMPLETION,
};

const INSTALL_HINTS: Record<string, string> = {
  bash: `# Add to ~/.bashrc:\n# eval "$(authme completion bash)"`,
  zsh: `# Add to ~/.zshrc:\n# eval "$(authme completion zsh)"`,
  fish: `# Save to your fish completions directory:\n# authme completion fish > ~/.config/fish/completions/authme.fish`,
};

export function registerCompletionCommand(program: Command): void {
  program
    .command('completion <shell>')
    .description('Output shell completion script (bash, zsh, fish)')
    .action((shell: string) => {
      const script = SCRIPTS[shell];
      if (!script) {
        console.error(chalk.red(`Unknown shell "${shell}". Supported: bash, zsh, fish`));
        process.exitCode = 1;
        return;
      }
      process.stdout.write(script.trimStart());
      if (process.stdout.isTTY) {
        console.log(chalk.dim(`\n# --- Install hint ---`));
        console.log(chalk.dim(INSTALL_HINTS[shell]));
      }
    });
}
