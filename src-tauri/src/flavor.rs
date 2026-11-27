#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flavor {
    Tor,
    Local,
}

impl Flavor {
    pub const fn id(self) -> &'static str {
        match self {
            Flavor::Tor => "tor",
            Flavor::Local => "local",
        }
    }

    pub const fn product_name(self) -> &'static str {
        match self {
            Flavor::Tor => "PULSO Tor",
            Flavor::Local => "PULSO Local",
        }
    }

    pub const fn tor_version(self) -> Option<&'static str> {
        match self {
            Flavor::Tor => Some("16.0"),
            Flavor::Local => None,
        }
    }

    pub const fn allows_tunnel(self) -> bool {
        matches!(self, Flavor::Local)
    }

    pub const fn allows_clearnet_update_check(self) -> bool {
        matches!(self, Flavor::Local)
    }
}

pub const fn current_flavor() -> Flavor {
    #[cfg(feature = "flavor-tor")]
    {
        return Flavor::Tor;
    }
    #[cfg(not(feature = "flavor-tor"))]
    {
        Flavor::Local
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tor_flavor_metadata_disallows_clearnet_and_tunnel() {
        assert_eq!(Flavor::Tor.id(), "tor");
        assert_eq!(Flavor::Tor.product_name(), "PULSO Tor");
        assert_eq!(Flavor::Tor.tor_version(), Some("16.0"));
        assert!(!Flavor::Tor.allows_tunnel());
        assert!(!Flavor::Tor.allows_clearnet_update_check());
    }

    #[test]
    fn local_flavor_metadata_allows_tunnel_and_manual_update_check() {
        assert_eq!(Flavor::Local.id(), "local");
        assert_eq!(Flavor::Local.product_name(), "PULSO Local");
        assert_eq!(Flavor::Local.tor_version(), None);
        assert!(Flavor::Local.allows_tunnel());
        assert!(Flavor::Local.allows_clearnet_update_check());
    }

    #[test]
    fn current_flavor_matches_compile_time_feature() {
        #[cfg(feature = "flavor-tor")]
        assert_eq!(current_flavor(), Flavor::Tor);
        #[cfg(not(feature = "flavor-tor"))]
        assert_eq!(current_flavor(), Flavor::Local);
    }
}
