document.documentElement.classList.add("js")

// Native content remains available when JavaScript is disabled.
const tabs = [...document.querySelectorAll('[role="tab"]')]
const panels = [...document.querySelectorAll('[role="tabpanel"]')]
function selectTab(selected) {
	for (const tab of tabs) {
		const active = tab === selected
		tab.setAttribute("aria-selected", String(active))
		tab.tabIndex = active ? 0 : -1
	}
	for (const panel of panels) {
		panel.hidden = panel.id !== selected.getAttribute("aria-controls")
	}
}
for (const [index, tab] of tabs.entries()) {
	tab.addEventListener("click", () => selectTab(tab))
	tab.addEventListener("keydown", (event) => {
		let next
		if (event.key === "ArrowRight") next = (index + 1) % tabs.length
		if (event.key === "ArrowLeft")
			next = (index - 1 + tabs.length) % tabs.length
		if (event.key === "Home") next = 0
		if (event.key === "End") next = tabs.length - 1
		if (next === undefined) return
		event.preventDefault()
		selectTab(tabs[next])
		tabs[next].focus()
	})
}
if (tabs.length) selectTab(tabs[0])

const copyStatus = document.getElementById("copy-status")
for (const button of document.querySelectorAll(".copy-button")) {
	button.hidden = false
	let resetTimer
	button.addEventListener("click", async () => {
		clearTimeout(resetTimer)
		try {
			await navigator.clipboard.writeText(button.dataset.copy)
			button.textContent = "Copied ✓"
			copyStatus.textContent = "Install command copied to clipboard."
		} catch {
			button.textContent = "Try again"
			copyStatus.textContent =
				"Could not copy. Select and copy the command manually."
		}
		resetTimer = setTimeout(() => {
			button.textContent = "Copy ⧉"
			copyStatus.textContent = ""
		}, 2500)
	})
}

const menuToggle = document.getElementById("menu-toggle")
const navigation = document.getElementById("primary-nav")
if (menuToggle && navigation) {
	menuToggle.hidden = false
	function closeMenu() {
		navigation.classList.remove("is-open")
		menuToggle.setAttribute("aria-expanded", "false")
	}
	menuToggle.addEventListener("click", () => {
		const open = navigation.classList.toggle("is-open")
		menuToggle.setAttribute("aria-expanded", String(open))
	})
	for (const link of navigation.querySelectorAll("a")) {
		link.addEventListener("click", closeMenu)
	}
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && navigation.classList.contains("is-open")) {
			closeMenu()
			menuToggle.focus()
		}
	})
	document.addEventListener("click", (event) => {
		if (
			!navigation.contains(event.target) &&
			!menuToggle.contains(event.target)
		) {
			closeMenu()
		}
	})
}
