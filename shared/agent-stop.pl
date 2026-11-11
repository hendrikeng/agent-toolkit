#!/usr/bin/perl -T
# agent-stop: stops a background process that an agent started, also from the Claude sandbox.
# Usage: agent-stop [--signal TERM|INT|KILL] [--wait <seconds>] <pid>...
#        agent-stop [--signal TERM|INT|KILL] [--wait <seconds>] --port <port>...
#
# The sandbox excludes this file by its installed path, so it runs unsandboxed with arguments that an agent chooses.
# It therefore signals a process only if the process belongs to this user, its working directory is below an
# allowed root, and it is not a protected process. Refusal is the default for every unclear case.
# Taint mode (-T) makes Perl ignore PERL5LIB, PERLLIB, and PERL5OPT, so the caller cannot load code into it.
# No argument is ever run as code or passed to a shell. External programs run from fixed paths with a list exec.
# Remaining race: the checks run again immediately before kill(2), and the last one compares owner and start time.
# The kernel can still reuse the pid in the few milliseconds between that check and the signal.
use strict;
use warnings;
no warnings 'exec'; # output() reports a failed exec as no output.
use Cwd qw(abs_path);
use POSIX ();

$ENV{PATH} = '/usr/bin:/bin:/usr/sbin:/sbin';
delete @ENV{qw(IFS CDPATH ENV BASH_ENV)};

sub usage { print STDERR "Usage: agent-stop [--signal TERM|INT|KILL] [--wait <seconds>] <pid>...\n       agent-stop [--signal TERM|INT|KILL] [--wait <seconds>] --port <port>...\n"; exit 2 }
my ($signal, $wait, $ports, @operands) = ('TERM', 0, 0);
while (@ARGV) {
 my $arg = shift @ARGV;
 if ($arg eq '--signal') { (shift(@ARGV) // '') =~ /^(TERM|INT|KILL)$/ or usage(); $signal = $1 }
 elsif ($arg eq '--wait') { (shift(@ARGV) // '') =~ /^(\d{1,3})$/ or usage(); $wait = $1 }
 elsif ($arg eq '--port') { $ports = 1 }
 elsif ($arg =~ /^-\d+$/ || $arg !~ /^-/) { push @operands, $arg } # A negative pid is a refused target, not an option.
 else { usage() }
}
usage() unless @operands;

my ($lsof) = grep { -x } '/usr/sbin/lsof', '/usr/bin/lsof';
$lsof //= '/usr/sbin/lsof';
# Run a fixed program without a shell. stderr goes to /dev/null. Returns the output lines.
sub output {
 my $pid = open(my $fh, '-|') // return ();
 if (!$pid) { open(STDERR, '>', '/dev/null'); exec { $_[0] } @_; POSIX::_exit(127) }
 my @lines = <$fh>;
 close($fh);
 chomp @lines;
 return @lines;
}

# The only root list in this file. scripts/apply-claude-sandbox.test.cjs fails if the sandbox allowWrite roots differ.
# The home directory comes from the password database, and on macOS the temporary directory from getconf.
my $home = (getpwuid($<))[7];
my @roots = ((map { "$home/Code/$_" } qw(paseo-worktrees tracn wewereyoung envest)), $^O eq 'darwin' ? (output('/usr/bin/getconf', 'DARWIN_USER_TEMP_DIR'), "/private/tmp/claude-$<") : ($ENV{TMPDIR} || '/tmp'));
# Roots are fixed paths. Only the macOS aliases /var and /tmp are resolved. A root must be a directory of this user,
# and no part of its path can be a symlink. A symlink can therefore never move a root to another directory.
@roots = grep { my @stat = lstat; @stat && -d _ && $stat[4] == $< && (abs_path($_) // '') eq $_ }
 map { my $root = s{/+$}{}r; $^O eq 'darwin' ? $root =~ s{^/(var|tmp)/}{/private/$1/}r : $root } grep { defined && $_ ne '' } @roots;

# The caller and its parent chain: stopping one of them would stop the agent itself.
my %callers = (1 => 1, $$ => 1);
for (my ($pid, $depth) = (getppid(), 0); $pid > 1 && !$callers{$pid} && $depth < 100; $depth++) {
 $callers{$pid} = 1;
 ($pid) = map { /^\s*(\d+)$/ ? $1 : 0 } output('/bin/ps', '-o', 'ppid=', '-p', $pid);
 $pid //= 0;
}

# Agent hosts, browsers, and terminal apps. On macOS, every executable inside an .app bundle is protected.
my $protected = qr/\b(paseo|claude|codex|chrome|chromium|firefox|safari|tmux)\b/i;
sub identity {
 my ($pid) = @_;
 my ($uid, $start) = map { /^\s*(\d+)\s+(.+?)\s*$/ ? ($1, $2) : () } output('/bin/ps', '-o', 'uid=,lstart=', '-p', $pid);
 return defined $uid ? "$uid $start" : undef;
}
# The first lsof name of a file descriptor type: cwd is the working directory, txt is the executable first.
sub path_of {
 my ($pid, $type) = @_;
 my $path = $^O eq 'linux' ? readlink("/proc/$pid/" . ($type eq 'txt' ? 'exe' : 'cwd'))
  : (map { /^n(.+)$/ ? $1 : () } output($lsof, '-a', '-p', $pid, '-d', $type, '-Fn'))[0];
 return defined $path && $path =~ m{^/} ? abs_path($path) : undef;
}
# Returns undef if the process may get the signal, or the reason for the refusal.
sub refusal {
 my ($pid) = @_;
 return 'protected: init or the caller of agent-stop' if $callers{$pid};
 my $identity = identity($pid) // return 'gone';
 return 'owned by another user' unless $identity =~ /^(\d+) / && $1 == $<;
 # ps shows argv, which a process can choose. The txt descriptor gives the real executable.
 my $executable = path_of($pid, 'txt');
 my ($command) = output('/bin/ps', '-o', 'comm=', '-p', $pid);
 my ($args) = output('/bin/ps', '-o', 'args=', '-p', $pid);
 return 'cannot read the executable or the command' unless defined $executable && defined $command && defined $args;
 return 'protected: macOS app' if grep { m{\.app/} } $executable, $command;
 my @names = map { m{([^/]*)$} } grep { defined } $executable, $command, (split ' ', $args)[0, 1];
 return 'protected: agent host, browser, or terminal' if grep { defined && /$protected/ } @names;
 my $cwd = path_of($pid, 'cwd') // return 'cannot read the working directory';
 return "working directory $cwd is outside the allowed roots" unless grep { index($cwd, "$_/") == 0 } @roots;
 # Same working directory, owner, and start time again, immediately before the signal.
 return 'changed during the checks' unless (path_of($pid, 'cwd') // '') eq $cwd && (identity($pid) // '') eq $identity;
 return undef;
}

my ($failed, @signaled) = (0);
for my $operand (@operands) {
 my @pids;
 if ($ports) {
  if ($operand !~ /^([1-9]\d{0,4})$/ || $1 > 65535) { print "port $operand: refused: not a port number\n"; $failed = 1; next }
  my $port = $1;
  @pids = map { /^([1-9]\d*)$/ ? $1 : () } output($lsof, '-nP', "-iTCP:$port", '-sTCP:LISTEN', '-t');
  if (!@pids) { print "port $port: not found\n"; next }
 } elsif ($operand =~ /^([1-9]\d{0,9})$/) { @pids = ($1) }
 else { print "pid $operand: refused: not a single process id (no groups, 0, or names)\n"; $failed = 1; next }
 for my $pid (@pids) {
  my $label = $ports ? "port $operand pid $pid" : "pid $pid";
  my $reason = refusal($pid);
  if (defined $reason && $reason eq 'gone') { print "$label: not found\n"; next }
  if (defined $reason) { print "$label: refused: $reason\n"; $failed = 1; next }
  if (kill($signal, $pid)) { print "$label: stopped ($signal)\n"; push @signaled, [$label, $pid]; next }
  if ($!{ESRCH}) { print "$label: not found\n"; next }
  print "$label: refused: kill failed: $! (run agent-stop by its full installed path as a separate call)\n"; $failed = 1;
 }
}

# Optional: report what still runs. There is no automatic escalation to KILL.
# A zombie has stopped and only waits for its parent, so it does not count.
for (my $end = time + $wait; $wait && @signaled; select(undef, undef, undef, 0.2)) {
 @signaled = grep { my ($state) = output('/bin/ps', '-o', 'stat=', '-p', $_->[1]); defined $state && $state !~ /^\s*Z/ } @signaled;
 last if time >= $end;
}
if ($wait) { print "$_->[0]: still running after ${wait}s\n" for @signaled; $failed ||= @signaled ? 1 : 0 }
exit $failed;
