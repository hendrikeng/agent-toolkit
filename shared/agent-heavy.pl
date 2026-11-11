#!/usr/bin/perl
# agent-heavy: a machine-wide semaphore for heavy local checks. Local resource policy only: it never changes a result.
# Usage: agent-heavy -- <program> [args...]
#
# Slots are files in one lock directory. The kernel releases a flock when its holder exits, so no stale-slot logic
# exists. The lock descriptors are close-on-exec, so a background process that a check starts never holds a slot.
# Accepted trade-off: if the wrapper itself is SIGKILLed, the kernel frees the slot while the command still runs.
# One extra command can then run until that command stops. This corrects itself and can never stall.
use strict;
use warnings;
no warnings 'exec'; # A failed exec reports its error below.
use Fcntl qw(:flock O_RDWR O_CREAT);
use POSIX qw(floor);
use Cwd qw(getcwd);
use File::Spec;

if (@ARGV < 2 || $ARGV[0] ne '--') { print STDERR "Usage: agent-heavy -- <program> [args...]\n"; exit 2 }
shift @ARGV;

sub direct {
 exec { $ARGV[0] } @ARGV;
 print STDERR "agent-heavy: could not start $ARGV[0]: $!\n";
 exit 127;
}
# Fail open: the throttle must never fail the command.
sub fail_open { print STDERR "agent-heavy: throttle unavailable, running without a slot ($_[0])\n"; direct() }
sub output {
 open(my $fh, '-|', @_) or return undef;
 my $value = <$fh>;
 close($fh) or return undef;
 chomp $value if defined $value;
 return $value;
}

direct() if ($ENV{AGENT_HEAVY} // '') eq '0' || ($ENV{AGENT_HEAVY_HELD} // '') eq '1';

my $darwin = $^O eq 'darwin';
my $cpus = $darwin ? output('/usr/sbin/sysctl', '-n', 'hw.logicalcpu') : output('nproc');
fail_open('cannot read the CPU count') unless defined $cpus && $cpus =~ /^[1-9]\d*$/;
my $slots = $ENV{AGENT_HEAVY_SLOTS} // '';
if ($slots !~ /^[1-9]\d*$/) {
 my $memory;
 if ($darwin) { $memory = output('/usr/sbin/sysctl', '-n', 'hw.memsize') }
 elsif (open(my $info, '<', '/proc/meminfo')) { while (<$info>) { if (/^MemTotal:\s+(\d+) kB/) { $memory = $1 * 1024; last } } }
 fail_open('cannot read the memory size') unless defined $memory && $memory =~ /^\d+$/;
 my ($by_memory, $by_cpu) = (floor($memory / (20 * 2**30)), floor($cpus / 6));
 $slots = $by_memory < $by_cpu ? $by_memory : $by_cpu;
 $slots = 1 if $slots < 1;
}
my $workers = floor($cpus / $slots);
$ENV{AGENT_HEAVY_HELD} = '1';
$ENV{AGENT_HEAVY_WORKERS} = $workers < 1 ? 1 : $workers;

# Not $TMPDIR: agents can get different values, and the lock must be one per machine user.
my $dir = $ENV{AGENT_HEAVY_DIR};
if (defined $dir && $dir ne '') { $dir = File::Spec->rel2abs($dir) }
elsif ($darwin) {
 my $temporary = output('/usr/bin/getconf', 'DARWIN_USER_TEMP_DIR');
 fail_open('cannot read DARWIN_USER_TEMP_DIR') unless defined $temporary && $temporary ne '';
 $dir = ($temporary =~ s{/+$}{}r) . '/agent-heavy';
} else { $dir = ($ENV{XDG_RUNTIME_DIR} || '/tmp') . "/agent-heavy-$<" }
mkdir($dir, 0700) or $!{EEXIST} or fail_open("cannot create $dir: $!");
my @stat = lstat($dir);
fail_open("$dir is not a directory that this user owns") unless @stat && -d _ && !-l _ && $stat[4] == $<;
chmod(0700, $dir) or fail_open("cannot set the mode of $dir: $!");

my @locks;
for my $index (0 .. $slots - 1) {
 # Perl opens descriptors above $^F (2) with close-on-exec, so the command does not inherit them.
 sysopen(my $fh, "$dir/slot-$index", O_RDWR | O_CREAT, 0600) or fail_open("cannot open $dir/slot-$index: $!");
 push @locks, $fh;
}
sub busy {
 my @holders;
 for my $index (0 .. $slots - 1) {
  my $holder = 'unknown';
  if (open(my $fh, '<', "$dir/slot-$index.owner")) { my (undef, $cwd, $command) = map { chomp; $_ } <$fh>; $holder = "$cwd $command" if defined $command }
  push @holders, $holder;
 }
 return "$slots/$slots busy: " . join(', ', @holders);
}
my ($slot, $notice) = (undef, time + 30);
while (!defined $slot) {
 for my $index (0 .. $#locks) {
  if (flock($locks[$index], LOCK_EX | LOCK_NB)) { $slot = $index; last }
  fail_open("cannot lock $dir/slot-$index: $!") unless $!{EWOULDBLOCK};
 }
 last if defined $slot;
 if (time >= $notice) { print STDERR 'agent-heavy: waiting for a slot (' . busy() . ")\n"; $notice = time + 30 }
 select(undef, undef, undef, 1 + rand());
}

# Best effort, only for the waiting line. Only the lock holder writes or removes this file.
my $owner = "$dir/slot-$slot.owner";
if (open(my $fh, '>', "$owner.$$")) {
 print $fh "$$\n" . (getcwd() // '?') . "\n@ARGV\n";
 close($fh) and rename("$owner.$$", $owner);
}
unlink("$owner.$$");

my $child = fork();
fail_open("cannot fork: $!") unless defined $child;
if ($child == 0) {
 exec { $ARGV[0] } @ARGV;
 print STDERR "agent-heavy: could not start $ARGV[0]: $!\n";
 POSIX::_exit(127);
}
# The terminal sends SIGINT and SIGQUIT to the whole process group, so the command already gets them.
# Agents and tools send SIGTERM and SIGHUP to the wrapper pid, so forward those. A signal to the whole group
# can then reach the command twice.
$SIG{INT} = $SIG{QUIT} = 'IGNORE';
$SIG{TERM} = $SIG{HUP} = sub { kill($_[0], $child) };
while (waitpid($child, 0) == -1) { last unless $!{EINTR} }
my $status = $?;
unlink($owner);
exit($status & 127 ? 128 + ($status & 127) : $status >> 8);
