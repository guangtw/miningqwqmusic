using Windows.ApplicationModel;
using Windows.ApplicationModel.Activation;
using Windows.Foundation;
using Windows.Foundation.Collections;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Navigation;
using Microsoft.UI.Xaml.Shapes;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace MiningQwQMusic;

/// <summary>
/// Provides application-specific behavior to supplement the default Application class.
/// </summary>
public partial class App : Application
{
    private MainWindow? _window;
    private MiningQwQMusic.Services.SingleInstance? instance;

    /// <summary>
    /// Initializes the singleton application object.  This is the first line of authored code
    /// executed, and as such is the logical equivalent of main() or WinMain().
    /// </summary>
    public App()
    {
        UnhandledException += (_, args) =>
        {
            MiningQwQMusic.Services.Diagnostics.Log("应用异常", args.Exception);
        };
        InitializeComponent();
    }

    /// <summary>
    /// Invoked when the application is launched.
    /// </summary>
    /// <param name="args">Details about the launch request and process.</param>
    protected override void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
    {
        instance = new MiningQwQMusic.Services.SingleInstance();
        if (!instance.IsFirst) { instance.Dispose(); Exit(); return; }
        _window = new MainWindow();
        instance.Listen(() => _window.DispatcherQueue.TryEnqueue(() =>
        {
            _window.RestoreFromTray();
        }));
        _window.Closed += (_, _) => instance.Dispose();
        _window.Activate();
    }
}
