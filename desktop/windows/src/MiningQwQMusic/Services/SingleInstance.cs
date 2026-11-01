namespace MiningQwQMusic.Services;

internal sealed class SingleInstance : IDisposable
{
    private readonly Mutex mutex;
    private readonly EventWaitHandle activated;
    private RegisteredWaitHandle? registration;
    public bool IsFirst { get; }

    public SingleInstance()
    {
        var name = @"Local\MiningQwQMusic." + Environment.UserName;
        mutex = new Mutex(true, name, out var first);
        IsFirst = first;
        activated = new EventWaitHandle(false, EventResetMode.AutoReset, name + ".Activate");
        if (!first) activated.Set();
    }

    public void Listen(Action activate) => registration = ThreadPool.RegisterWaitForSingleObject(activated, (_, _) => activate(), null, Timeout.Infinite, false);

    public void Dispose()
    {
        registration?.Unregister(null);
        activated.Dispose();
        if (IsFirst) mutex.ReleaseMutex();
        mutex.Dispose();
    }
}
