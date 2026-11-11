#!/usr/bin/perl
# agent-stop: stops a background process that an agent started, also from the Claude sandbox.
# Usage: agent-stop [--signal TERM|INT|KILL] [--wait <seconds>] <pid>...
#        agent-stop [--signal TERM|INT|KILL] [--wait <seconds>] --port <port>...
#
# The sandbox excludes this file by its installed path, so it runs unsandboxed with arguments that an agent chooses.
# It therefore signals a process only if the process belongs to this user, its working directory is below an
# allowed root, and it is not a protected process. Refusal is the default for every unclear case.
# No argument is ever run as code or passed to a shell. External programs run with a list exec.
# Remaining race: the checks run again immediately before kill(2), and the last one compares owner and start time.
# The kernel can still reuse the pid in the few milliseconds between that check and the signal.
use strict;
use warnings;
no warnings 'exec'; # output() reports a failed exec as no output.
use Cwd qw(abs_path);
use POSIX ();

sub usage { print STDERR "Usage: agent-stop [--signal TERM|INT|KILL] [--wait <seconds>] <pid>...\n       agent-stop [--signal TERM|INT|KILL] [--wait <seconds>] --port <port>...\n"; exit 2 }
my ($signal, $wait, $ports, @operands) = ('TERM', 0, 0);
while (@ARGV) {
 my $arg = shift @ARGV;
 if ($arg eq '--signal') { $signal = shift(@ARGV) // usage(); usage() unless $signal =~ /^(TERM|INT|KILL)$/ }
 elsif ($arg eq '--wait') { $wait = shift(@ARGV) // usage(); usage() unless $wait =~ /^\d{1,3}$/ }
 elsif ($arg eq '--port') { $ports = 1 }
 elsif ($arg =~ /^-\d+$/ || $arg !~ /^-/) { push @operands, $arg } # A negative pid is a refused target, not an option.
 else { usage() }
}
usage() unless @operands;

# Fixed paths, not PATH, because the caller controls PATH.
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

# The allowed roots match the sandbox allowWrite roots in docs/claude-sandbox.md, plus ~/Code/envest.
# They come from the password database and getconf, not from HOME or TMPDIR, which the caller controls.
my $home = (getpwuid($<))[7];
my @roots = map { "$home/Code/$_" } qw(paseo-worktrees tracn wewereyoung envest);
if ($^O eq 'darwin') { push @roots, output('/usr/bin/getconf', 'DARWIN_USER_TEMP_DIR'), "/private/tmp/claude-$<" }
else { push @roots, $ENV{TMPDIR} || '/tmp' } # ponytail: the Claude sandbox exclusion is macOS only.
@roots = grep { defined && $_ ne '/' } map { abs_path($_) } grep { defined && $_ ne '' } @roots;

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
sub cwd_of {
 my ($pid) = @_;
 my $cwd = $^O eq 'linux' ? readlink("/proc/$pid/cwd")
  : (map { /^n(.+)$/ ? $1 : () } output($lsof, '-a', '-p', $pid, '-d', 'cwd', '-Fn'))[0];
 return defined $cwd && $cwd =~ m{^/} ? abs_path($cwd) : undef;
}
# Returns undef if the process may get the signal, or the reason for the refusal.
sub refusal {
 my ($pid) = @_;
 return 'protected: init or the caller of agent-stop' if $callers{$pid};
 my $identity = identity($pid) // return 'gone';
 return 'owned by another user' unless $identity =~ /^(\d+) / && $1 == $<;
 my ($command) = output('/bin/ps', '-o', 'comm=', '-p', $pid);
 my ($args) = output('/bin/ps', '-o', 'args=', '-p', $pid);
 return 'cannot read the command' unless defined $command && defined $args;
 return 'protected: macOS app' if $command =~ m{\.app/};
 my @names = map { m{([^/]*)$} } grep { defined } $command, (split ' ', $args)[0, 1];
 return 'protected: agent host, browser, or terminal' if grep { defined && /$protected/ } @names;
 my $cwd = cwd_of($pid) // return 'cannot read the working directory';
 return "working directory $cwd is outside the allowed roots" unless grep { index($cwd, "$_/") == 0 } @roots;
 # Same owner, start time, and working directory again, immediately before the signal.
 return 'changed during the checks' unless (cwd_of($pid) // '') eq $cwd && (identity($pid) // '') eq $identity;
 return undef;
}

my ($failed, @signaled) = (0);
for my $operand (@operands) {
 my @pids;
 if ($ports) {
  if ($operand !~ /^[1-9]\d{0,4}$/ || $operand > 65535) { print "port $operand: refused: not a port number\n"; $failed = 1; next }
  @pids = grep { /^[1-9]\d*$/ } output($lsof, '-nP', "-iTCP:$operand", '-sTCP:LISTEN', '-t');
  if (!@pids) { print "port $operand: not found\n"; next }
 } elsif ($operand !~ /^[1-9]\d{0,9}$/) {
  print "pid $operand: refused: not a single process id (no groups, 0, or names)\n"; $failed = 1; next;
 } else { @pids = ($operand) }
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
