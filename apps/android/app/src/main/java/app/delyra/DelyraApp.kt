package app.delyra

import android.app.Application

class DelyraApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
        graph.session.restore()
    }
}
