package com.tradezoro.app.ui

import com.tradezoro.app.ui.auth.SignInViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SignInViewModelTest {
    @Before fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())
    @After fun tearDown() = Dispatchers.resetMain()

    @Test fun submitNeedsEmailAndPassword() {
        var calls = 0
        val vm = SignInViewModel({ _, _ -> calls++ }, { })
        vm.submit {}
        assertEquals(0, calls)
        vm.email("  a@b.co "); vm.password("x")
        assertEquals("a@b.co", vm.form.value.email)
        var done = false
        vm.submit { done = true }
        assertEquals(1, calls); assertTrue(done); assertFalse(vm.form.value.busy)
    }

    @Test fun errorIsShownAndClearedOnEdit() {
        val vm = SignInViewModel({ _, _ -> throw RuntimeException("boom") }, { })
        vm.email("a@b.co"); vm.password("x"); vm.submit {}
        assertEquals("Something went wrong. Please try again.", vm.form.value.error)
        vm.password("y")
        assertEquals(null, vm.form.value.error)
    }

    @Test fun forgotNeedsEmail() {
        var sent: String? = null
        val vm = SignInViewModel({ _, _ -> }, { sent = it })
        vm.forgot()
        assertEquals(null, sent); assertTrue(vm.form.value.error!!.startsWith("Enter your email"))
        vm.email("a@b.co"); vm.forgot()
        assertEquals("a@b.co", sent); assertEquals("Reset link sent. Check your inbox.", vm.form.value.info)
    }
}
